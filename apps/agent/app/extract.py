"""Reading invoices.

`extract_batch` is the seam. Today it returns the Lab 06 sample batch so the
whole pipeline runs without Bedrock or S3. The real version reads each PDF from
S3 and asks Bedrock for the fields, with a confidence per field so anything
uncertain is marked in the interface rather than presented as fact.

Swap with EXTRACT_BACKEND=bedrock.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass

from .types import Extracted

log = logging.getLogger("app.extract")

# The six invoices the workshop pre-provisions, transcribed from the PDFs.
_SAMPLE = [
    ("FPL-SAMPLE-0001", "fpl-invoice-01.pdf", "4500001463", "10300006", "QM003", "5", "10.00", "50.00", "V1", "59.50"),
    ("FPL-1563", "fpl-invoice-02.pdf", "4500001563", "17401710", "TG12", "10", "11.35", "113.50", "V0", "113.50"),
    ("FPL-1638", "fpl-invoice-03.pdf", "4500001638", "17401710", "TG12", "10", "11.35", "113.50", "V0", "113.50"),
    ("FPL-1650", "fpl-invoice-04.pdf", "4500001650", "17401710", "TG12", "10", "11.35", "113.50", "V0", "113.50"),
    ("FPL-1697", "fpl-invoice-05.pdf", "4500001697", "17401710", "TG12", "10", "11.35", "113.50", "V0", "113.50"),
    # Deliberate failure shipped by the workshop: this purchase order does not exist.
    ("FPL-9999", "fpl-invoice-06.pdf", "4500009999", "17401710", "TG12", "10", "11.35", "113.50", "V0", "113.50"),
]


def sample_batch() -> list[Extracted]:
    return [
        Extracted(
            invoice_id=invoice_id,
            file=file,
            supplier_invoice_id=invoice_id,
            vendor=vendor,
            purchase_order=po,
            purchase_order_item="10",
            material=material,
            quantity=qty,
            unit="PC",
            unit_price=price,
            net_amount=net,
            tax_code=tax,
            gross_amount=gross,
            currency="EUR",
            company_code="1010",
        )
        for invoice_id, file, po, vendor, material, qty, price, net, tax, gross in _SAMPLE
    ]


SYSTEM = """You read documents for an SAP Accounts Payable team. You do two things \
in one pass: decide whether the document is a supplier invoice at all, and if it \
is, map it to SAP S/4HANA fields. Return only a JSON object, no prose.

Rules:
- Decide `is_invoice` first. A supplier invoice bills a company for goods or \
services and carries an invoice number and an amount payable. A delivery note, \
purchase order, quotation, statement, receipt, contract, photograph or any other \
document is not a supplier invoice.
- If it is not an invoice, say so in `not_invoice_reason` in one short sentence a \
clerk would understand, and leave the other fields empty. Do not guess at fields \
to be helpful.
- Copy values exactly as printed. Never invent, correct or complete a value.
- Amounts and quantities are plain decimal strings: "113.50", not "113,50 EUR".
- If a field is genuinely absent, use "" and give it a confidence of 0.
- confidence is your certainty per field, 0 to 1. Be honest: a value you inferred \
rather than read is below 0.8."""

PROMPT = """Read this document.

Return exactly this shape:

{
  "is_invoice": true,
  "not_invoice_reason": "empty when is_invoice is true; otherwise what it is instead",
  "supplier_invoice_id": "the supplier's own invoice number",
  "vendor": "supplier or vendor number",
  "purchase_order": "purchase order number",
  "purchase_order_item": "PO line item, usually 10",
  "material": "material code",
  "quantity": "quantity as a decimal string",
  "unit": "unit of measure, e.g. PC",
  "unit_price": "unit price as a decimal string",
  "net_amount": "net amount as a decimal string",
  "tax_code": "tax code, e.g. V1 or V0",
  "gross_amount": "gross amount as a decimal string",
  "currency": "ISO currency code",
  "company_code": "company code",
  "confidence": { "purchase_order": 0.0, "vendor": 0.0, "net_amount": 0.0 }
}"""


def _s3_bytes(key: str) -> bytes:
    import boto3

    bucket = os.getenv("INVOICE_BUCKET", "516359819848-invoice")
    body = boto3.client("s3", region_name=os.getenv("AWS_REGION", "us-east-1")).get_object(
        Bucket=bucket, Key=key
    )
    return body["Body"].read()


@dataclass(frozen=True)
class Rejected:
    """A document that was uploaded but is not a supplier invoice."""

    file: str
    reason: str


def _one(key: str) -> Extracted | Rejected:
    from .bedrock import ask_json

    name = key.rsplit("/", 1)[-1]
    fields = ask_json(SYSTEM, PROMPT, document=_s3_bytes(key), name=name)

    # Default to rejecting. A document the model could not confidently call an
    # invoice must not fall through into the validation pipeline, where every
    # rule would compare empty strings and report a confident nonsense answer.
    if not fields.get("is_invoice"):
        return Rejected(
            file=name,
            reason=str(fields.get("not_invoice_reason") or "").strip()
            or "This does not look like a supplier invoice.",
        )

    return Extracted(
        invoice_id=fields.get("supplier_invoice_id") or name,
        file=name,
        supplier_invoice_id=fields.get("supplier_invoice_id", ""),
        vendor=fields.get("vendor", ""),
        purchase_order=fields.get("purchase_order", ""),
        purchase_order_item=fields.get("purchase_order_item") or "10",
        material=fields.get("material", ""),
        quantity=fields.get("quantity", ""),
        unit=fields.get("unit") or "PC",
        unit_price=fields.get("unit_price", ""),
        net_amount=fields.get("net_amount", ""),
        tax_code=fields.get("tax_code", ""),
        gross_amount=fields.get("gross_amount", ""),
        currency=fields.get("currency") or "EUR",
        company_code=fields.get("company_code") or "1010",
        confidence={k: float(v) for k, v in (fields.get("confidence") or {}).items()},
    )


async def extract_batch(
    keys: list[str], sample: bool = False
) -> tuple[list[Extracted], list[Rejected]]:
    """Read what was uploaded. Returns the invoices, and what was not one.

    The sample batch is now only reachable by asking for it: `sample=True`, which
    the interface's "load sample batch" button sends, or `EXTRACT_BACKEND=sample`.

    It used to be the fallback whenever `keys` was empty. That meant a failed
    upload silently produced six invoices nobody had uploaded, and the run looked
    perfect - which is how uploads stayed broken without anyone noticing. An
    empty batch is now an empty batch.
    """
    if sample or os.getenv("EXTRACT_BACKEND", "sample") != "bedrock":
        return sample_batch(), []

    if not keys:
        return [], []

    import asyncio

    # Read the batch concurrently; the orchestrator paces the emission afterwards,
    # so extraction speed does not affect how the cascade looks.
    results = await asyncio.gather(*(asyncio.to_thread(_one, key) for key in keys))

    invoices = [r for r in results if isinstance(r, Extracted)]
    rejected = [r for r in results if isinstance(r, Rejected)]
    log.info("extracted %d invoices, rejected %d documents", len(invoices), len(rejected))
    return invoices, rejected
