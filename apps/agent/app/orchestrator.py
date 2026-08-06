"""The state machine.

    uploaded -> extracting -> validating -> awaiting-approval -> posting -> done
                                                              \\-> failed

No model output causes a transition. That is what makes the single approval gate
structural rather than an instruction a model might disregard: `/approve` is a
separate request, and this rejects it unless the run is awaiting approval.

Pacing lives here too. The interface's validation cascade is driven by event
arrival, so an unpaced flush collapses it into one frame. Emitting one rule per
~60ms means the frontend writes no stagger logic at all.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import AsyncIterator, Literal

from . import db
from . import events as ev
from .extract import extract_batch
from .judge import Judge
from .rules import AGENT_RULE_IDS, RULE_COUNT, RuleResult, run_deterministic
from .sap import Sap, SapError
from .types import Extracted, GoodsReceipt, PurchaseOrder

log = logging.getLogger("app.run")

# Emission floors, in seconds. See contract/events.md.
FLOOR_RULE = 0.06
FLOOR_INVOICE = 0.11
FLOOR_POSTING = 0.06
BEAT = 0.52

POSTING_DATE = "2025-03-15"
MINUTES_PER_INVOICE_SAVED = 17

# Question-and-answer pairs carried into the next question.
HISTORY_TURNS = 6

# Invoices whose network work runs at once. A demo batch is six, so six starts
# them all; the cap exists so a larger batch cannot fire dozens of concurrent
# Converse calls and start collecting throttling errors.
PREPARE_CONCURRENCY = 6

State = Literal[
    "uploaded", "extracting", "validating", "awaiting-approval", "posting", "done", "failed"
]


@dataclass
class Run:
    run_id: str
    account: str
    locale: str = "en"
    state: State = "uploaded"
    sequence_base: int = 1
    invoices: list[Extracted] = field(default_factory=list)
    ready: list[str] = field(default_factory=list)
    blocked: list[str] = field(default_factory=list)

    # What the checks decided, accumulated during the run and written to the
    # database once it settles. Questions are answered from there, not from here:
    # without a record of any kind, the only way to answer anything is to
    # validate all over again, which is what the first version did and why asking
    # a question re-ran six invoices.
    results: dict[str, list[RuleResult]] = field(default_factory=dict)
    headlines: dict[str, str] = field(default_factory=dict)
    sap_documents: dict[str, str] = field(default_factory=dict)

    def reference_for(self, index: int) -> str:
        """`<account>-<n>`, capped at 16 characters by SAP.

        The sequence base comes from the run rather than a constant, so a second
        run produces fresh references. Reusing `-1` is what trips the duplicate
        rule and blocks an entire rehearsal.
        """
        return f"{self.account}-{self.sequence_base + index}"


class RunStore:
    """In-memory. A demo has one run at a time and no persistence requirement.

    The sequence base does not start at 1. Restarting the process would otherwise
    replay references already parked in SAP - which is a shared system, so those
    references exist forever and rule 16 blocks the whole batch. Seeding from the
    clock means a restart cannot collide with an earlier session.

    The reference is `<12-digit account>-<n>` and SAP caps it at 16 characters,
    so n has three digits to work with.
    """

    def __init__(self) -> None:
        self._runs: dict[str, Run] = {}
        self._next_sequence = int(time.time()) % 900 + 1

    def create(self, run_id: str, account: str, locale: str) -> Run:
        # Advance past whatever the previous run consumed, so re-runs never
        # collide on the invoice reference.
        run = Run(run_id=run_id, account=account, locale=locale, sequence_base=self._next_sequence)
        self._next_sequence += 50
        self._runs[run_id] = run
        return run

    def get(self, run_id: str) -> Run | None:
        return self._runs.get(run_id)


def _rule_event(run: Run, inv: Extracted, result: RuleResult) -> ev.Rule:
    by_agent = result.rule_id in AGENT_RULE_IDS
    return ev.Rule(
        invoiceId=inv.invoice_id,
        ruleId=result.rule_id,
        label=result.label,
        status="pass" if result.passed else "fail",
        decidedBy="agent" if by_agent else "rule",
        detail=result.detail,
        evidence=result.evidence,
        reasoning=result.reasoning,
        citation=result.citation,
    )


def mark_duplicates(invoices: list[Extracted]) -> None:
    """Flag any invoice already billed by an earlier file in the same batch.

    This is the duplicate SAP cannot catch. Neither copy has been parked yet, and
    the orchestrator gives every row its own fresh reference, so all sixteen
    checks pass on both and the supplier is paid twice.

    Identity is the supplier and their invoice number, not the file name - the
    same invoice forwarded twice arrives under two different names, which is
    exactly the case worth catching. A document with no invoice number cannot be
    compared, so it is left alone rather than guessed at.
    """
    seen: dict[tuple[str, str], str] = {}
    for inv in invoices:
        if not inv.supplier_invoice_id:
            continue
        identity = (inv.vendor, inv.supplier_invoice_id)
        if identity in seen:
            inv.duplicate_of = seen[identity]
        else:
            seen[identity] = inv.file


async def _prepare(
    inv: Extracted, sap: Sap, judge: Judge, gate: asyncio.Semaphore
) -> tuple[
    PurchaseOrder | None, GoodsReceipt | None, dict[int, RuleResult], list[PurchaseOrder]
]:
    """Everything for one invoice that needs the network, fetched concurrently.

    The semaphore is not politeness: six invoices at three model calls each is
    eighteen concurrent Converse requests, which is where a workshop account
    starts returning throttling errors.
    """
    async with gate:
        # Independent of each other, both round trips to SAP.
        po, inv.existing_reference = await asyncio.gather(
            sap.purchase_order(inv.purchase_order, inv.purchase_order_item),
            sap.reference_exists(inv.vendor, inv.reference),
        )
        # This one does depend on the order existing, so it waits.
        gr = await sap.goods_receipt(inv.purchase_order, inv.purchase_order_item) if po else None

        # One call for rules 4, 7 and 9 rather than three. They share the same
        # facts, and three requests per invoice was the batch's main contention.
        #
        # A missing order is knowable now, so the replacement search runs here
        # too, alongside everything else. Left where it used to be - after the
        # invoice had already failed - it ran on its own at the end of the batch
        # and added half a minute to the one row the audience is watching.
        judged, alternatives = await asyncio.gather(
            judge.judge_all(inv, po),
            sap.open_orders_for(inv.vendor, inv.material) if po is None else _none(),
        )
        supplier, material, price = judged

    results = {**run_deterministic(inv, po, gr), 4: supplier, 7: material, 9: price}
    return po, gr, results, alternatives


async def _none() -> list[PurchaseOrder]:
    """A resolved empty result, so the gather above stays one expression."""
    return []


async def validate_run(
    run: Run, keys: list[str], sap: Sap, judge: Judge, sample: bool = False
) -> AsyncIterator[ev.Event]:
    """Read-only. Extract, validate, summarise, then wait for a human."""

    run.state = "extracting"
    yield ev.Text(delta="Files received. Reading them now.")
    await asyncio.sleep(BEAT)

    started = time.perf_counter()
    run.invoices, rejected = await extract_batch(keys, sample=sample)
    log.info(
        "%s extracted %d invoices, rejected %d, in %.1fs",
        run.run_id,
        len(run.invoices),
        len(rejected),
        time.perf_counter() - started,
    )

    for document in rejected:
        # Named individually. "2 documents were skipped" makes the person open
        # every file to find out which; naming them ends the question.
        yield ev.Text(delta=f"{document.file} — {document.reason} Nothing was checked for it.")
        await asyncio.sleep(FLOOR_INVOICE)

    if not run.invoices:
        run.state = "failed"
        yield ev.Error(
            message=(
                "No supplier invoices to check."
                if rejected
                else "No documents were received, so there is nothing to check."
            ),
            recoverable=True,
        )
        return
    mark_duplicates(run.invoices)

    for index, inv in enumerate(run.invoices):
        inv.reference = run.reference_for(index)
        inv.posting_date = POSTING_DATE

    # Started before the invoice rows are even announced. Those rows take a
    # second of deliberate pacing to appear, and that second is free network
    # time. References have to be assigned first, because the duplicate check
    # reads them.
    gate = asyncio.Semaphore(PREPARE_CONCURRENCY)
    prepared = {
        inv.invoice_id: asyncio.create_task(_prepare(inv, sap, judge, gate))
        for inv in run.invoices
    }

    yield ev.Batch(runId=run.run_id, reference=run.reference_for(0), count=len(run.invoices))

    for inv in run.invoices:
        yield ev.Invoice(
            invoiceId=inv.invoice_id,
            file=inv.file,
            supplierInvoiceId=inv.supplier_invoice_id,
            vendor=inv.vendor,
            purchaseOrder=inv.purchase_order,
            purchaseOrderItem=inv.purchase_order_item,
            material=inv.material,
            quantity=inv.quantity,
            unit=inv.unit,
            unitPrice=inv.unit_price,
            netAmount=inv.net_amount,
            taxCode=inv.tax_code,
            grossAmount=inv.gross_amount,
            currency=inv.currency,
            companyCode=inv.company_code,
            confidence=inv.confidence or None,
        )
        await asyncio.sleep(FLOOR_INVOICE)

    yield ev.Text(
        delta=f"Extracted {len(run.invoices)} invoices. Checking each against SAP master data."
    )
    await asyncio.sleep(BEAT)

    run.state = "validating"
    rules_run = 0
    agent_decided = 0

    for inv in run.invoices:
        invoice_started = time.perf_counter()
        yield ev.ToolCall(
            invoiceId=inv.invoice_id,
            method="GET",
            resource=f"A_PurchaseOrder('{inv.purchase_order}')",
            status="ok",
        )
        po, gr, results, alternatives = await prepared[inv.invoice_id]
        run.results[inv.invoice_id] = [results[rule_id] for rule_id in sorted(results)]

        failures: list[RuleResult] = []
        stopped = False

        for rule_id in range(1, RULE_COUNT + 1):
            result = results.get(rule_id)
            if result is None:
                continue

            if stopped:
                # Once a check fails the rest cannot be evaluated honestly - a
                # missing order has nothing to compare against. Report them as
                # skipped rather than inventing passes.
                yield ev.Rule(
                    invoiceId=inv.invoice_id,
                    ruleId=rule_id,
                    label=result.label,
                    status="skip",
                    decidedBy="agent" if rule_id in AGENT_RULE_IDS else "rule",
                )
                continue

            rules_run += 1
            if rule_id in AGENT_RULE_IDS:
                agent_decided += 1
            if not result.passed:
                failures.append(result)
                stopped = rule_id == 1

            yield _rule_event(run, inv, result)
            await asyncio.sleep(FLOOR_RULE)

        log.info(
            "%s %s -> %s in %.1fs%s",
            run.run_id,
            inv.invoice_id,
            "BLOCKED" if failures else "ready",
            time.perf_counter() - invoice_started,
            (
                " on " + ", ".join(f"rule {f.rule_id} {f.label}" for f in failures)
                if failures
                else ""
            ),
        )

        if failures:
            run.blocked.append(inv.invoice_id)
            suggestion = None
            if any(f.rule_id == 1 for f in failures):
                yield ev.ToolCall(
                    invoiceId=inv.invoice_id,
                    method="GET",
                    resource=f"A_PurchaseOrder?$filter=Supplier eq '{inv.vendor}'",
                    status="ok",
                )
                # Already fetched during preparation, alongside this invoice's
                # other network work.
                if alternatives:
                    alt = alternatives[0]
                    suggestion = ev.Suggestion(
                        text=(
                            f"Supplier {inv.vendor} has one open, goods-receipted order for the "
                            f"same material and amount: {alt.number}."
                        ),
                        action="reassign-po",
                        value=alt.number,
                    )

            run.headlines[inv.invoice_id] = await judge.explain(inv, failures, run.locale)

            yield ev.InvoiceStatus(
                invoiceId=inv.invoice_id,
                status="blocked",
                headline=run.headlines[inv.invoice_id],
                impact=(
                    "This invoice cannot be parked. The rest of the batch is unaffected."
                ),
                suggestion=suggestion,
            )
            # Deliberate pause: a person is still reading the explanation.
            await asyncio.sleep(BEAT * 1.6)
        else:
            run.ready.append(inv.invoice_id)
            yield ev.InvoiceStatus(invoiceId=inv.invoice_id, status="ready")
            await asyncio.sleep(FLOOR_INVOICE)

    yield ev.Summary(
        runId=run.run_id,
        ready=len(run.ready),
        blocked=len(run.blocked),
        rulesRun=rules_run,
        agentDecided=agent_decided,
        minutesSaved=len(run.ready) * MINUTES_PER_INVOICE_SAVED,
    )
    await asyncio.sleep(BEAT * 0.7)

    run.state = "awaiting-approval"
    # On disk before the run is handed to a human. Everything the chat can answer
    # comes from here, so a question survives a reload, a restart, and the next
    # batch replacing this one on screen.
    db.save_run(run)
    yield ev.Approval(runId=run.run_id, readyIds=run.ready, blockedIds=run.blocked)


def odata_date(day: str) -> str:
    """`2025-03-15` -> `/Date(1741996800000)/`.

    OData V2 carries dates as epoch milliseconds in that wrapper. Sending the
    plain string is accepted by nothing and fails at the point of writing.
    """
    stamp = datetime.strptime(day, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    return f"/Date({int(stamp.timestamp() * 1000)})/"


def park_payload(inv: Extracted, index: int, run: Run) -> dict:
    """The deep insert Lab 06 specifies. Status A parks; it never posts for payment."""
    posting = odata_date(inv.posting_date)
    return {
        "CompanyCode": inv.company_code,
        "DocumentDate": posting,
        "PostingDate": posting,
        "SupplierInvoiceIDByInvcgParty": inv.reference,
        "InvoicingParty": inv.vendor,
        "DocumentCurrency": inv.currency,
        "InvoiceGrossAmount": inv.gross_amount,
        "SupplierInvoiceStatus": "A",
        "TaxIsCalculatedAutomatically": True,
        "to_SuplrInvcItemPurOrdRef": [
            {
                "SupplierInvoiceItem": "1",
                "PurchaseOrder": inv.purchase_order,
                "PurchaseOrderItem": inv.purchase_order_item,
                "TaxCode": inv.tax_code,
                "DocumentCurrency": inv.currency,
                "SupplierInvoiceItemAmount": inv.net_amount,
                "QuantityInPurchaseOrderUnit": inv.quantity,
                "PurchaseOrderQuantityUnit": inv.unit,
            }
        ],
    }


async def post_run(run: Run, sap: Sap) -> AsyncIterator[ev.Event]:
    """The only path that writes to SAP."""

    if run.state != "awaiting-approval":
        yield ev.Error(message="This run is not waiting for approval.", recoverable=False)
        return

    run.state = "posting"
    yield ev.Text(delta=f"Parking approved invoices as status A, from reference {run.reference_for(0)}.")
    await asyncio.sleep(BEAT * 0.7)

    for index, inv in enumerate(run.invoices):
        if inv.invoice_id not in run.ready:
            continue

        yield ev.ToolCall(
            invoiceId=inv.invoice_id,
            method="POST",
            resource=f"A_SupplierInvoice - {inv.reference}",
            status="pending",
        )
        try:
            parked = await sap.park(park_payload(inv, index, run))
        except SapError as error:
            # One failure never stops the batch - that is the whole point of the
            # per-invoice gate.
            log.error("%s %s park failed: %s", run.run_id, inv.invoice_id, error)
            yield ev.Posting(invoiceId=inv.invoice_id, status="error", message=str(error))
            continue

        log.info(
            "%s %s parked as SAP document %s, reference %s",
            run.run_id,
            inv.invoice_id,
            parked.sap_document,
            inv.reference,
        )
        run.sap_documents[inv.invoice_id] = parked.sap_document
        yield ev.Posting(
            invoiceId=inv.invoice_id,
            status="parked",
            reference=inv.reference,
            sapDocument=parked.sap_document,
            fiscalYear=parked.fiscal_year,
        )
        await asyncio.sleep(FLOOR_POSTING)

    run.state = "done"
    # Again, so "what happened to FPL-1563?" can answer with its SAP document.
    db.save_run(run)
    yield ev.Text(
        delta=(
            f"{len(run.ready)} parked documents in SAP, fiscal year 2025. "
            f"{len(run.blocked)} still open."
        )
    )


async def answer_run(
    message: str,
    locale: str = "en",
    session_id: str = "default",
    run_id: str | None = None,
) -> AsyncIterator[ev.Event]:
    """Answer a typed question. Read-only, and it touches no state machine.

    No Run is needed. Everything answerable lives in the database - the invoices,
    the checks, and now the conversation - so a question survives a restart, a
    reload, and a batch being replaced on screen. That is why there is no longer
    an "I no longer have that batch" reply to give.
    """
    from .ask import answer

    # Read before writing, so the current question is not also in the history.
    past = db.history(session_id, HISTORY_TURNS * 2)
    db.add_message(session_id, "user", message, run_id)

    spoken: list[str] = []
    try:
        async for delta in answer(message, locale, past):
            spoken.append(delta)
            yield ev.Text(delta=delta)
    except Exception as error:  # noqa: BLE001 - a failed answer must not fail the run
        log.exception("answering failed")
        yield ev.Text(delta=f"I could not answer that: {error}")
        return

    # Only a complete answer is remembered. Recording a half-streamed one would
    # teach the next turn to refer back to something the user never finished
    # reading.
    db.add_message(session_id, "assistant", "".join(spoken), run_id)
    log.info("%s answered from %d turns of history", session_id, len(past))
