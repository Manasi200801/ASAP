"""Shared value objects. Kept separate so `rules` and `sap` do not import each other."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class Extracted:
    """One invoice, as read off the PDF and mapped to SAP field names.

    Amounts stay strings until a rule needs arithmetic - floats would silently
    lose cents on the way through, and SAP hands us decimal strings anyway.
    """

    invoice_id: str
    file: str
    supplier_invoice_id: str
    vendor: str
    purchase_order: str
    purchase_order_item: str
    material: str
    quantity: str
    unit: str
    unit_price: str
    net_amount: str
    tax_code: str
    gross_amount: str
    currency: str
    company_code: str

    # Set by the orchestrator, not by extraction.
    reference: str = ""
    posting_date: str = ""
    existing_reference: str | None = None

    confidence: dict[str, float] = field(default_factory=dict)


@dataclass(frozen=True)
class PurchaseOrder:
    number: str
    item: str | None
    company_code: str
    currency: str
    supplier: str
    material: str | None
    open_quantity: str | None
    net_price: str | None
    tax_code: str | None
    blocked: bool = False
    fully_invoiced: bool = False
    gr_based_invoicing: bool = True


@dataclass(frozen=True)
class GoodsReceipt:
    document: str
    quantity: str


@dataclass(frozen=True)
class Parked:
    sap_document: str
    fiscal_year: str
