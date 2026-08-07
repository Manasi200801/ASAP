"""Reading invoices.

`extract_batch` is the seam. With EXTRACT_BACKEND=sample it returns the Lab 06
batch transcribed below, so the whole pipeline runs without Bedrock or S3. With
`bedrock` it reads each PDF out of S3 and asks Bedrock for the fields, with a
confidence per field so anything uncertain is marked in the interface rather
than presented as fact.

Keys arrive as `s3://bucket/key`, because two buckets are readable: clerk
uploads land in UPLOAD_BUCKET, and the workshop's own PDFs live in
INVOICE_BUCKET. A bare key means the upload bucket.
"""

from __future__ import annotations

import logging
import os

from .storage import split_uri, upload_bucket
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


SYSTEM = """You read supplier invoices for an SAP Accounts Payable team and map \
them to SAP S/4HANA fields. Return only a JSON object, no prose.

Rules:
- Copy values exactly as printed. Never invent, correct or complete a value.
- Amounts and quantities are plain decimal strings: "113.50", not "113,50 EUR".
- If a field is genuinely absent, use "" and give it a confidence of 0.
- confidence is your certainty per field, 0 to 1. Be honest: a value you inferred \
rather than read is below 0.8."""

PROMPT = """Extract this invoice.

Return exactly this shape:

{
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


def resolve(key: str) -> tuple[str, str]:
    """`s3://bucket/key` -> (bucket, key). A bare key means the upload bucket.

    Two buckets are readable now - clerk uploads and the workshop's own PDFs -
    so a key alone no longer says where it lives. Bare keys keep resolving
    against the upload bucket, which is where everything the browser sends goes.
    """
    if key.startswith("s3://"):
        return split_uri(key)
    return upload_bucket(), key


def _s3_bytes(bucket: str, key: str) -> bytes:
    import boto3

    body = boto3.client("s3", region_name=os.getenv("AWS_REGION", "us-east-1")).get_object(
        Bucket=bucket, Key=key
    )
    return body["Body"].read()


def _one(key: str) -> Extracted:
    from .bedrock import ask_json

    bucket, path = resolve(key)
    name = path.rsplit("/", 1)[-1]
    fields = ask_json(SYSTEM, PROMPT, document=_s3_bytes(bucket, path), name=name)

    return Extracted(
        source=f"s3://{bucket}/{path}",
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


def workshop_keys() -> list[str]:
    """The six PDFs the workshop pre-provisions, addressed in their own bucket.

    This is what "Load batch" runs. It reads the real files through Bedrock
    rather than returning the transcribed constants, so the demo path exercises
    the same code as a clerk's upload. The mover refuses to delete from this
    bucket, so replaying the batch never consumes it.
    """
    bucket = os.getenv("INVOICE_BUCKET", "516359819848-invoice")
    return [f"s3://{bucket}/fpl-invoice-0{n}.pdf" for n in range(1, 7)]


async def extract_batch(keys: list[str]) -> list[Extracted]:
    """Read a batch. In bedrock mode nothing here is transcribed.

    An empty batch used to fall back to `sample_batch()` even with the bedrock
    backend selected, so a clerk could upload real PDFs, watch a convincing run,
    and be looking at Lab 06 constants. Now an empty batch means the workshop
    PDFs, read for real; only EXTRACT_BACKEND=sample returns transcriptions.
    """
    if os.getenv("EXTRACT_BACKEND", "sample") != "bedrock":
        return sample_batch()

    import asyncio

    batch = keys or workshop_keys()
    if not keys:
        log.info("no keys supplied, reading the %d workshop invoices", len(batch))

    # Read the batch concurrently; the orchestrator paces the emission afterwards,
    # so extraction speed does not affect how the cascade looks.
    return list(await asyncio.gather(*(asyncio.to_thread(_one, key) for key in batch)))
