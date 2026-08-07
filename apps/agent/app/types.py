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

    # Where the PDF was read from, as `s3://bucket/key`. Empty in sample mode.
    # Filing the invoice after posting has to delete the exact object it read;
    # reconstructing that from `file` guesses at the bucket, and a wrong guess
    # deletes someone else's object.
    source: str = ""

    # Set by the orchestrator, not by extraction.
    reference: str = ""
    posting_date: str = ""
    existing_reference: str | None = None

    # The supplier id SAP itself uses, taken from the purchase order. The invoice
    # prints the legacy vendor number (17401710); S/4HANA knows the same party as
    # a Business Partner (BP1710) and rejects a write addressed to the printed
    # one. Rule 4 judges the two equivalent, which settles validation but says
    # nothing about which id the write has to carry.
    sap_supplier: str = ""

    def party(self) -> str:
        """Who to address SAP as. Falls back to the printed number."""
        return self.sap_supplier or self.vendor

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
