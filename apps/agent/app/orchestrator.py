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
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import AsyncIterator, Literal

from . import events as ev
from .extract import extract_batch
from .judge import Judge
from .rules import AGENT_RULE_IDS, RULE_COUNT, RuleResult, run_deterministic
from .sap import Sap, SapError
from .types import Extracted

# Emission floors, in seconds. See contract/events.md.
FLOOR_RULE = 0.06
FLOOR_INVOICE = 0.11
FLOOR_POSTING = 0.06
BEAT = 0.52

POSTING_DATE = "2025-03-15"
MINUTES_PER_INVOICE_SAVED = 17

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

    run.invoices = await extract_batch(keys)
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
        yield ev.ToolCall(
            invoiceId=inv.invoice_id,
            method="GET",
            resource=f"A_PurchaseOrder('{inv.purchase_order}')",
            status="ok",
        )
        po = await sap.purchase_order(inv.purchase_order, inv.purchase_order_item)
        gr = await sap.goods_receipt(inv.purchase_order, inv.purchase_order_item) if po else None
        inv.existing_reference = await sap.reference_exists(inv.vendor, inv.reference)

        deterministic = run_deterministic(inv, po, gr)
        judged = {
            4: await judge.supplier_matches(inv, po),
            7: await judge.material_matches(inv, po),
            9: await judge.price_within_policy(inv, po),
        }
        results = {**deterministic, **judged}

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

            yield ev.InvoiceStatus(
                invoiceId=inv.invoice_id,
                status="blocked",
                headline=await judge.explain(inv, failures, run.locale),
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
            yield ev.Posting(invoiceId=inv.invoice_id, status="error", message=str(error))
            continue

        yield ev.Posting(
            invoiceId=inv.invoice_id,
            status="parked",
            reference=inv.reference,
            sapDocument=parked.sap_document,
            fiscalYear=parked.fiscal_year,
        )
        await asyncio.sleep(FLOOR_POSTING)

    run.state = "done"
    yield ev.Text(
        delta=(
            f"{len(run.ready)} parked documents in SAP, fiscal year 2025. "
            f"{len(run.blocked)} still open."
        )
    )
