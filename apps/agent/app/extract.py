"""Reading invoices.

`extract_batch` is the seam. Today it returns the Lab 06 sample batch so the
whole pipeline runs without Bedrock or S3. The real version reads each PDF from
S3 and asks Bedrock for the fields, with a confidence per field so anything
uncertain is marked in the interface rather than presented as fact.

Swap with EXTRACT_BACKEND=bedrock.
"""

from __future__ import annotations

import os

from .types import Extracted

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


async def extract_batch(keys: list[str]) -> list[Extracted]:
    if os.getenv("EXTRACT_BACKEND", "sample") != "bedrock":
        return sample_batch()
    raise NotImplementedError(
        "Read each key from s3://<INVOICE_BUCKET>/<key>, send the PDF to Bedrock, and return "
        "Extracted with a confidence per field. Anything below 0.8 gets marked in the UI."
    )
