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

    # The goods receipt this invoice settles, kept from validation so the park
    # payload can reference it. SAP rejects the write without it wherever the
    # purchase order uses GR-based invoice verification.
    gr_document: str = ""
    gr_year: str = ""
    gr_item: str = ""

    # The file earlier in this same batch that bills the same supplier invoice.
    # Nothing in SAP can catch this one: neither has been parked yet, and each
    # row is assigned its own fresh reference, so both would post cleanly.
    duplicate_of: str | None = None

    # The SAP document this supplier invoice was already parked as, on an earlier
    # run. The same document arriving a second time next week is the duplicate
    # that costs real money, and our own reference cannot see it - that is minted
    # fresh every run, so it only ever collides with itself.
    already_parked: str | None = None

    confidence: dict[str, float] = field(default_factory=dict)

    def party(self) -> str:
        """Who to address SAP as. Falls back to the printed number."""
        return self.sap_supplier or self.vendor


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
    # The material document's own key. Under GR-based invoice verification SAP
    # refuses to park an item that does not point back at the receipt it is
    # settling - "Fill in mandatory field 'ReferenceDocument, -FiscalYear,
    # -Item'" - so all three travel together or the write fails.
    year: str = ""
    item: str = ""


@dataclass(frozen=True)
class Parked:
    sap_document: str
    fiscal_year: str
