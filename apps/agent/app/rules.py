"""The deterministic rules.

Thirteen of the sixteen checks are comparisons against what SAP already returned.
A model adds latency and doubt to those and nothing else, so they live here as
pure functions - countable, testable, and identical on every run.

The other three (supplier identity, material match, price tolerance) need
judgment and live in `judge.py`. That split is the whole architecture: policy is
code, judgment is model, and every result records which decided it.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Callable

from .sap import GoodsReceipt, PurchaseOrder
from .types import Extracted

# Rule ids are 1-based and match `contract/events.md`.
RULE_COUNT = 16
AGENT_RULE_IDS = frozenset({4, 7, 9})

# The workshop SAP books run in early 2025; today's date fails to park.
OPEN_POSTING_PERIOD = "2025-03"

QUANTITY_TOLERANCE = Decimal("0.00")  # invoiced qty must not exceed the open PO qty


@dataclass(frozen=True)
class RuleResult:
    rule_id: int
    label: str
    passed: bool
    detail: str | None = None
    evidence: str | None = None
    # Set only by the judgment layer. Its presence is what the interface renders
    # as an agent-decided check that opens to its reasoning.
    reasoning: str | None = None
    citation: str | None = None


def _dec(value: str | None) -> Decimal | None:
    if value is None:
        return None
    try:
        return Decimal(value.replace(",", ""))
    except (InvalidOperation, AttributeError):
        return None


def _rule(rule_id: int, label: str):
    """Register a check. Keeps the id, label and logic in one place."""

    def wrap(fn: Callable[[Extracted, PurchaseOrder | None, GoodsReceipt | None], RuleResult]):
        fn.rule_id = rule_id  # type: ignore[attr-defined]
        fn.label = label  # type: ignore[attr-defined]
        return fn

    return wrap


def _ok(rule_id: int, label: str, detail: str | None = None, evidence: str | None = None):
    return RuleResult(rule_id, label, True, detail, evidence)


def _no(rule_id: int, label: str, detail: str, evidence: str | None = None):
    return RuleResult(rule_id, label, False, detail, evidence)


# --- 1-3: the purchase order itself ------------------------------------------


@_rule(1, "PO exists")
def po_exists(inv: Extracted, po: PurchaseOrder | None, gr: GoodsReceipt | None) -> RuleResult:
    if po is None:
        return _no(1, "PO exists", f"Purchase order {inv.purchase_order} not found in SAP")
    return _ok(1, "PO exists", evidence=f"A_PurchaseOrder('{po.number}')")


@_rule(2, "PO is open")
def po_open(inv: Extracted, po: PurchaseOrder | None, gr: GoodsReceipt | None) -> RuleResult:
    if po is None:
        return _no(2, "PO is open", "No purchase order to check")
    if po.blocked:
        return _no(2, "PO is open", "The purchase order is blocked")
    if po.fully_invoiced:
        return _no(2, "PO is open", "The purchase order is already fully invoiced")
    return _ok(2, "PO is open")


@_rule(3, "PO line item exists")
def po_item_exists(inv: Extracted, po: PurchaseOrder | None, gr: GoodsReceipt | None) -> RuleResult:
    if po is None or po.item is None:
        return _no(3, "PO line item exists", f"Item {inv.purchase_order_item} not on the order")
    return _ok(3, "PO line item exists", evidence=f"PurchaseOrderItem {po.item}")


# --- 5-6: header agreement ----------------------------------------------------


@_rule(5, "Company code matches")
def company_code(inv: Extracted, po: PurchaseOrder | None, gr: GoodsReceipt | None) -> RuleResult:
    if po is None:
        return _no(5, "Company code matches", "No purchase order to compare against")
    if inv.company_code != po.company_code:
        return _no(
            5,
            "Company code matches",
            f"Invoice is {inv.company_code}, the order is {po.company_code}",
        )
    return _ok(5, "Company code matches")


@_rule(6, "Currency matches")
def currency(inv: Extracted, po: PurchaseOrder | None, gr: GoodsReceipt | None) -> RuleResult:
    if po is None:
        return _no(6, "Currency matches", "No purchase order to compare against")
    if inv.currency != po.currency:
        return _no(6, "Currency matches", f"Invoice is {inv.currency}, the order is {po.currency}")
    return _ok(6, "Currency matches")


# --- 8: quantity --------------------------------------------------------------


@_rule(8, "Quantity within tolerance")
def quantity_tolerance(
    inv: Extracted, po: PurchaseOrder | None, gr: GoodsReceipt | None
) -> RuleResult:
    invoiced, ordered = _dec(inv.quantity), _dec(po.open_quantity) if po else None
    if invoiced is None or ordered is None:
        return _no(8, "Quantity within tolerance", "Quantity missing on the invoice or the order")
    if invoiced > ordered + QUANTITY_TOLERANCE:
        over = invoiced - ordered
        return _no(
            8,
            "Quantity within tolerance",
            f"Invoiced {invoiced} against {ordered} still open - {over} too many",
        )
    return _ok(8, "Quantity within tolerance")


# --- 10-11: the invoice's own arithmetic --------------------------------------


@_rule(10, "Line = qty x price")
def line_arithmetic(
    inv: Extracted, po: PurchaseOrder | None, gr: GoodsReceipt | None
) -> RuleResult:
    qty, price, net = _dec(inv.quantity), _dec(inv.unit_price), _dec(inv.net_amount)
    if qty is None or price is None or net is None:
        return _no(10, "Line = qty x price", "Quantity, price or net amount is missing")
    expected = qty * price
    if expected != net:
        return _no(10, "Line = qty x price", f"{qty} x {price} is {expected}, the line says {net}")
    return _ok(10, "Line = qty x price")


@_rule(11, "Gross = lines + tax")
def gross_arithmetic(
    inv: Extracted, po: PurchaseOrder | None, gr: GoodsReceipt | None
) -> RuleResult:
    net, gross = _dec(inv.net_amount), _dec(inv.gross_amount)
    if net is None or gross is None:
        return _no(11, "Gross = lines + tax", "Net or gross amount is missing")
    tax = gross - net
    if tax < 0:
        return _no(11, "Gross = lines + tax", f"Gross {gross} is below net {net}")
    return _ok(11, "Gross = lines + tax", detail=f"tax {tax}")


# --- 12-13: three-way match ---------------------------------------------------


@_rule(12, "Goods receipt exists")
def gr_exists(inv: Extracted, po: PurchaseOrder | None, gr: GoodsReceipt | None) -> RuleResult:
    if po is not None and not po.gr_based_invoicing:
        # Not every order is goods-receipt based; skipping is a pass, not a gap.
        return _ok(12, "Goods receipt exists", detail="Order is not goods-receipt based")
    if gr is None:
        return _no(12, "Goods receipt exists", "No goods receipt posted for this order")
    return _ok(12, "Goods receipt exists", evidence=f"MaterialDocument {gr.document}")


@_rule(13, "GR quantity sufficient")
def gr_quantity(inv: Extracted, po: PurchaseOrder | None, gr: GoodsReceipt | None) -> RuleResult:
    if po is not None and not po.gr_based_invoicing:
        return _ok(13, "GR quantity sufficient", detail="Order is not goods-receipt based")
    invoiced, received = _dec(inv.quantity), _dec(gr.quantity) if gr else None
    if invoiced is None or received is None:
        return _no(13, "GR quantity sufficient", "Quantity missing on the invoice or the receipt")
    if invoiced > received:
        return _no(
            13,
            "GR quantity sufficient",
            f"Invoiced {invoiced} but only {received} was received",
        )
    return _ok(13, "GR quantity sufficient")


# --- 14-16: posting rules -----------------------------------------------------


@_rule(14, "Tax code valid")
def tax_code(inv: Extracted, po: PurchaseOrder | None, gr: GoodsReceipt | None) -> RuleResult:
    if not inv.tax_code:
        return _no(14, "Tax code valid", "No tax code on the invoice")
    if po is not None and po.tax_code and inv.tax_code != po.tax_code:
        return _no(
            14, "Tax code valid", f"Invoice uses {inv.tax_code}, the order uses {po.tax_code}"
        )
    return _ok(14, "Tax code valid")


@_rule(15, "Posting period open")
def posting_period(inv: Extracted, po: PurchaseOrder | None, gr: GoodsReceipt | None) -> RuleResult:
    # The posting date is ours to choose, so this checks our own configuration
    # rather than the invoice. It exists because getting it wrong fails the park
    # with a posting-period error, at the worst possible moment.
    if not inv.posting_date.startswith(OPEN_POSTING_PERIOD):
        return _no(
            15,
            "Posting period open",
            f"Posting date {inv.posting_date} is outside the open period {OPEN_POSTING_PERIOD}",
        )
    return _ok(15, "Posting period open", detail=f"period {OPEN_POSTING_PERIOD}")


@_rule(16, "Not a duplicate")
def not_duplicate(inv: Extracted, po: PurchaseOrder | None, gr: GoodsReceipt | None) -> RuleResult:
    # The reference carries the run's sequence, so a re-run produces fresh
    # references and this passes. Reusing a sequence is what trips it.
    if inv.existing_reference:
        return _no(
            16,
            "Not a duplicate",
            f"Reference {inv.reference} already exists on document {inv.existing_reference}",
        )
    return _ok(16, "Not a duplicate", evidence=inv.reference)


DETERMINISTIC = [
    po_exists,
    po_open,
    po_item_exists,
    company_code,
    currency,
    quantity_tolerance,
    line_arithmetic,
    gross_arithmetic,
    gr_exists,
    gr_quantity,
    tax_code,
    posting_period,
    not_duplicate,
]


def run_deterministic(
    inv: Extracted, po: PurchaseOrder | None, gr: GoodsReceipt | None
) -> dict[int, RuleResult]:
    """Every deterministic rule, keyed by rule id."""
    return {fn.rule_id: fn(inv, po, gr) for fn in DETERMINISTIC}  # type: ignore[attr-defined]
