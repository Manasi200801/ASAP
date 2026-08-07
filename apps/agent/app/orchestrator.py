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

from . import events as ev
from .extract import extract_batch
from .judge import Judge
from .rules import AGENT_RULE_IDS, RULE_COUNT, RuleResult, run_deterministic
from .sap import Sap, SapError
from .storage import MoveError, Mover, blocked_bucket, processed_bucket
from .types import Extracted

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

    # What the checks decided, kept after the stream ends. A question typed once
    # the batch has settled is answered from this record; without it the only way
    # to answer anything is to validate all over again, which is what the first
    # version did and why asking a question re-ran six invoices.
    results: dict[str, list[RuleResult]] = field(default_factory=dict)
    headlines: dict[str, str] = field(default_factory=dict)

    # Questions and answers, in order. Without it every question is the first
    # question: "why was that one blocked?" has no idea which one, and "and the
    # others?" is unanswerable. Scoped to the run, so a new batch starts clean.
    conversation: list[tuple[str, str]] = field(default_factory=list)

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


async def validate_run(
    run: Run, keys: list[str], sap: Sap, judge: Judge
) -> AsyncIterator[ev.Event]:
    """Read-only. Extract, validate, summarise, then wait for a human."""

    run.state = "extracting"
    yield ev.Text(delta="Files received. Reading them now.")
    await asyncio.sleep(BEAT)

    started = time.perf_counter()
    run.invoices = await extract_batch(keys)
    log.info(
        "%s extracted %d invoices in %.1fs, references from %s",
        run.run_id,
        len(run.invoices),
        time.perf_counter() - started,
        run.reference_for(0),
    )
    yield ev.Batch(runId=run.run_id, reference=run.reference_for(0), count=len(run.invoices))

    for index, inv in enumerate(run.invoices):
        inv.reference = run.reference_for(index)
        inv.posting_date = POSTING_DATE
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
        po = await sap.purchase_order(inv.purchase_order, inv.purchase_order_item)
        gr = await sap.goods_receipt(inv.purchase_order, inv.purchase_order_item) if po else None

        # SAP's own id for this supplier, learned here and used for both the
        # duplicate lookup below and the eventual write. Asking about the number
        # printed on the invoice searches for a party SAP has never heard of, so
        # the duplicate check could only ever come back clean.
        if po and po.supplier:
            inv.sap_supplier = po.supplier

        inv.existing_reference = await sap.reference_exists(inv.party(), inv.reference)

        deterministic = run_deterministic(inv, po, gr)
        judged = {
            4: await judge.supplier_matches(inv, po),
            7: await judge.material_matches(inv, po),
            9: await judge.price_within_policy(inv, po),
        }
        results = {**deterministic, **judged}
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
                alternatives = await sap.open_orders_for(inv.vendor, inv.material)
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
    yield ev.Approval(runId=run.run_id, readyIds=run.ready, blockedIds=run.blocked)


def odata_date(day: str) -> str:
    """`2025-03-15` -> `/Date(1741996800000)/`.

    OData V2 carries dates as epoch milliseconds in that wrapper. Sending the
    plain string is accepted by nothing and fails at the point of writing.
    """
    stamp = datetime.strptime(day, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    return f"/Date({int(stamp.timestamp() * 1000)})/"


def park_payload(inv: Extracted, index: int, run: Run) -> dict:
    """The deep insert Lab 06 specifies. Status A parks; it never posts for payment.

    `InvoicingParty` is SAP's supplier id, not the number printed on the invoice.
    Every document in this system carries an id in SAP's own form; addressing a
    write to the printed legacy number gets it rejected with an OData error body
    rather than a document.
    """
    posting = odata_date(inv.posting_date)
    return {
        "CompanyCode": inv.company_code,
        "DocumentDate": posting,
        "PostingDate": posting,
        "SupplierInvoiceIDByInvcgParty": inv.reference,
        "InvoicingParty": inv.party(),
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


async def post_run(
    run: Run,
    sap: Sap,
    mover: Mover,
    overrides: list[str] | None = None,
    rejects: list[str] | None = None,
) -> AsyncIterator[ev.Event]:
    """The only path that writes to SAP, and the only one that files a PDF.

    `overrides` are invoices the checks blocked and a person approved anyway.
    They are posted exactly like a clean invoice - an override is an approval,
    not a reclassification, so SAP gets its say and whatever it answers is
    reported verbatim. Overriding a purchase order that does not exist fails at
    SAP, and that failure is the honest outcome.

    `rejects` are invoices a person turned down. They never reach SAP; they are
    filed to the blocked archive so the upload bucket only holds what is still
    undecided.
    """

    if run.state != "awaiting-approval":
        yield ev.Error(message="This run is not waiting for approval.", recoverable=False)
        return

    overridden = [i for i in (overrides or []) if i in run.blocked]
    rejected = [i for i in (rejects or []) if i in run.blocked]
    posting = run.ready + overridden

    run.state = "posting"
    log.info(
        "%s posting %d invoices (%d overridden), rejecting %d",
        run.run_id,
        len(posting),
        len(overridden),
        len(rejected),
    )
    yield ev.Text(delta=f"Parking approved invoices as status A, from reference {run.reference_for(0)}.")
    await asyncio.sleep(BEAT * 0.7)

    parked_ids: list[str] = []
    refused: list[str] = []

    for index, inv in enumerate(run.invoices):
        if inv.invoice_id not in posting:
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
            refused.append(inv.invoice_id)
            yield ev.Posting(invoiceId=inv.invoice_id, status="error", message=str(error))
            continue

        parked_ids.append(inv.invoice_id)
        log.info(
            "%s %s parked as SAP document %s, reference %s%s",
            run.run_id,
            inv.invoice_id,
            parked.sap_document,
            inv.reference,
            " (overridden)" if inv.invoice_id in overridden else "",
        )
        yield ev.Posting(
            invoiceId=inv.invoice_id,
            status="parked",
            reference=inv.reference,
            sapDocument=parked.sap_document,
            fiscalYear=parked.fiscal_year,
        )
        await asyncio.sleep(FLOOR_POSTING)

    async for event in _file_batch(run, mover, parked_ids, rejected):
        yield event

    run.state = "done"

    # A refusal has to be in this sentence. Reporting "0 parked" and stopping
    # describes a batch where nothing needed posting, which is the opposite of
    # one where SAP turned everything down - and it is the last line the user
    # reads before deciding the run went fine.
    still_open = len(run.blocked) - len(rejected) - len(overridden)
    parts = [f"{len(parked_ids)} parked documents in SAP, fiscal year 2025."]
    if refused:
        parts.append(
            f"SAP refused {len(refused)}: {', '.join(refused)}. "
            "Nothing was written for those - see each row for what SAP said."
        )
    if still_open:
        parts.append(f"{still_open} still open.")
    yield ev.Text(delta=" ".join(parts))


async def _file_batch(
    run: Run, mover: Mover, parked_ids: list[str], rejected: list[str]
) -> AsyncIterator[ev.Event]:
    """Send each settled PDF to its archive.

    Only two outcomes move a file: SAP took it, or a person turned it down.
    Everything else - blocked and undecided, or overridden and then refused by
    SAP - stays in the upload bucket. Nobody reached a verdict on those, and a
    refused park may well succeed on a retry once the underlying problem is
    fixed, so filing them as blocked would record a decision that was never made.
    """
    for inv in run.invoices:
        if inv.invoice_id in parked_ids:
            bucket = processed_bucket()
        elif inv.invoice_id in rejected:
            bucket = blocked_bucket()
        else:
            continue

        try:
            filed = await mover.file_to(inv.source, bucket)
        except MoveError as error:
            # The invoice is already parked in SAP. A misfiled PDF is a tidiness
            # problem and must not make a successful posting look broken.
            log.error("%s %s could not be filed: %s", run.run_id, inv.invoice_id, error)
            yield ev.Filed(invoiceId=inv.invoice_id, status="error", message=str(error))
            continue

        if filed is None:  # sample mode, or an invoice that never came from S3
            continue

        yield ev.Filed(
            invoiceId=inv.invoice_id,
            status="moved" if filed.deleted else "kept",
            bucket=filed.bucket,
            key=filed.key,
        )
        await asyncio.sleep(FLOOR_POSTING)


ANSWER_SYSTEM = """You are the accounts payable assistant for a batch of supplier
invoices that has already been checked against SAP S/4HANA.

Answer the user's question using only the run record you are given. The record is
the complete result of the checks; it is not a summary you should second-guess.

Rules:
- Answer in plain business language. The reader approves invoices; they do not
  know SAP field names or rule numbers, so translate rather than quote.
- Be specific. Name invoices, amounts and suppliers from the record.
- Amounts are in the currency stated in the record. Never convert them.
- Totals are given to you already calculated. Quote them. Never add figures up
  yourself and never present a sum the record does not state.
- Plain text only. No markdown, no asterisks - the answer is rendered as-is.
- If the record does not contain the answer, say so plainly and say what would.
- Never suggest you can post, park, reverse or change anything. You can only
  explain. Posting happens when the user presses Approve, never because of
  something said in conversation.
- Two or three sentences unless the question genuinely needs more. No headings,
  no bullet lists.
- A question may refer back to what was already discussed - "that one", "the
  others", "why not". Resolve it against the earlier turns you are given, and
  do not make the user repeat themselves.
"""


def _totals(run: Run) -> str:
    """Sums, computed here rather than left to the model.

    Asked for a batch total, a model will happily add the figures itself and get
    it wrong - an early version answered 454.00 for invoices totalling 513.50.
    Money arithmetic is not a judgement call, so it is done in Python and handed
    over as a fact.
    """
    from decimal import Decimal, InvalidOperation

    def total(invoice_ids: list[str]) -> str:
        amount = Decimal(0)
        for inv in run.invoices:
            if inv.invoice_id not in invoice_ids:
                continue
            try:
                amount += Decimal(inv.gross_amount)
            except InvalidOperation:  # an unparsable amount must not fake a total
                return "not calculable"
        return f"{amount:.2f}"

    currencies = {inv.currency for inv in run.invoices} or {"EUR"}
    currency = currencies.pop() if len(currencies) == 1 else "mixed currencies"
    return (
        f"Gross total ready to approve: {total(run.ready)} {currency}. "
        f"Gross total blocked: {total(run.blocked)} {currency}."
    )


def _run_record(run: Run) -> str:
    """The batch as text, for a question to be answered against."""
    lines = [
        f"Run {run.run_id}. State: {run.state}. "
        f"{len(run.ready)} ready, {len(run.blocked)} blocked, "
        f"{len(run.invoices)} invoices total.",
        _totals(run),
        "",
    ]

    for inv in run.invoices:
        verdict = "blocked" if inv.invoice_id in run.blocked else "ready"
        lines.append(
            f"{inv.invoice_id} ({inv.file}) - {verdict}. "
            f"Supplier invoice {inv.supplier_invoice_id}, supplier {inv.vendor}, "
            f"purchase order {inv.purchase_order} item {inv.purchase_order_item}, "
            f"{inv.quantity} {inv.unit} of {inv.material} at {inv.unit_price} each, "
            f"net {inv.net_amount}, gross {inv.gross_amount} {inv.currency}, "
            f"SAP reference {inv.reference or 'not yet assigned'}."
        )
        if inv.invoice_id in run.headlines:
            lines.append(f"  Why it is blocked: {run.headlines[inv.invoice_id]}")

        # Only the failures and the judged checks. Listing sixteen passes per
        # invoice buries the two lines that actually answer anything.
        for result in run.results.get(inv.invoice_id, []):
            if result.passed and result.rule_id not in AGENT_RULE_IDS:
                continue
            decided = "judged by the agent" if result.rule_id in AGENT_RULE_IDS else "rule"
            detail = result.detail or result.reasoning or ""
            lines.append(
                f"  Check {result.rule_id} '{result.label}': "
                f"{'passed' if result.passed else 'FAILED'} ({decided}). {detail}"
                + (f" Source: {result.citation}." if result.citation else "")
            )
        lines.append("")

    return "\n".join(lines)


async def answer_run(run: Run, message: str) -> AsyncIterator[ev.Event]:
    """Answer a typed question about a run that has already been checked.

    Read-only in the strongest sense: this touches neither SAP nor the run state.
    A question is a question, and answering one must never be able to re-trigger
    validation or move the state machine.
    """
    if not run.invoices:
        yield ev.Text(
            delta="There is no batch to discuss yet. Upload some invoices and I will check them."
        )
        return

    language = "German" if run.locale == "de" else "English"
    parts = [f"Run record:\n\n{_run_record(run)}"]

    if run.conversation:
        # Only the recent turns. The run record is the source of truth and is sent
        # in full every time; older chat adds tokens without adding facts, and a
        # long tail of it starts competing with the record for the model's
        # attention.
        history = "\n\n".join(
            f"Question: {question}\nYour answer: {answer}"
            for question, answer in run.conversation[-HISTORY_TURNS:]
        )
        parts.append(f"Earlier in this conversation:\n\n{history}")

    parts.append(f"Question: {message}\n\nAnswer in {language}.")
    prompt = "\n\n".join(parts)

    from .bedrock import stream_text

    spoken: list[str] = []
    try:
        async for delta in stream_text(ANSWER_SYSTEM, prompt):
            spoken.append(delta)
            yield ev.Text(delta=delta)
    except Exception as error:  # noqa: BLE001 - a failed answer must not fail the run
        yield ev.Text(delta=f"I could not answer that: {error}")
        return

    # Only a complete answer is remembered. Recording a half-streamed one would
    # teach the next turn to refer back to something the user never finished
    # reading.
    run.conversation.append((message, "".join(spoken)))
    log.info("%s answered in %d turns of history", run.run_id, len(run.conversation))
