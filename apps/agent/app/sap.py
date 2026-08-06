"""SAP access, behind one seam.

`FakeSap` lets the whole orchestrator run today, before Lab 05 deploys the AWS
for SAP MCP Server. `McpSap` is the only thing that changes once it exists -
every rule, every event and the entire frontend stay untouched.

Swap with SAP_BACKEND=mcp.
"""

from __future__ import annotations

import os
from typing import Protocol

from .types import GoodsReceipt, Parked, PurchaseOrder

COMPANY_CODE = "1010"

# The demo orders Lab 06 ships, all goods-receipted and ready to invoice.
_DEMO_ORDERS = {
    "4500001463": ("10300006", "QM003", "5", "10.00", "V1"),
    "4500001563": ("17401710", "TG12", "10", "11.35", "V0"),
    "4500001638": ("17401710", "TG12", "10", "11.35", "V0"),
    "4500001650": ("17401710", "TG12", "10", "11.35", "V0"),
    "4500001697": ("17401710", "TG12", "10", "11.35", "V0"),
}


class Sap(Protocol):
    async def purchase_order(self, number: str, item: str) -> PurchaseOrder | None: ...

    async def goods_receipt(self, number: str, item: str) -> GoodsReceipt | None: ...

    async def reference_exists(self, vendor: str, reference: str) -> str | None: ...

    async def open_orders_for(self, vendor: str, material: str) -> list[PurchaseOrder]: ...

    async def park(self, payload: dict) -> Parked: ...


class FakeSap:
    """Answers from the Lab 06 demo data. No network, no credentials.

    Deliberately reports `BP1710` for the vendor on orders belonging to supplier
    17401710 - that is what the real system does, and it is exactly the mismatch
    the judgment layer has to resolve. A fake that quietly agrees with the
    invoice would hide the one case worth testing.
    """

    def __init__(self) -> None:
        self._parked: dict[tuple[str, str], str] = {}
        self._next_document = 5100001500

    async def purchase_order(self, number: str, item: str) -> PurchaseOrder | None:
        order = _DEMO_ORDERS.get(number)
        if order is None:
            return None
        vendor, material, qty, price, tax = order
        return PurchaseOrder(
            number=number,
            item=item if item == "10" else None,
            company_code=COMPANY_CODE,
            currency="EUR",
            supplier="BP1710" if vendor == "17401710" else vendor,
            material=material,
            open_quantity=qty,
            net_price=price,
            tax_code=tax,
        )

    async def goods_receipt(self, number: str, item: str) -> GoodsReceipt | None:
        order = _DEMO_ORDERS.get(number)
        if order is None:
            return None
        return GoodsReceipt(document=f"50000009{number[-2:]}", quantity=order[2])

    async def reference_exists(self, vendor: str, reference: str) -> str | None:
        return self._parked.get((vendor, reference))

    async def open_orders_for(self, vendor: str, material: str) -> list[PurchaseOrder]:
        found = []
        for number, (order_vendor, order_material, *_rest) in _DEMO_ORDERS.items():
            if order_vendor == vendor and order_material == material:
                order = await self.purchase_order(number, "10")
                if order:
                    found.append(order)
        return found

    async def park(self, payload: dict) -> Parked:
        vendor = payload["InvoicingParty"]
        reference = payload["SupplierInvoiceIDByInvcgParty"]
        if (vendor, reference) in self._parked:
            raise SapError(f"Reference {reference} already exists for supplier {vendor}")
        document = str(self._next_document)
        self._next_document += 1
        self._parked[(vendor, reference)] = document
        return Parked(sap_document=document, fiscal_year="2025")


class SapError(RuntimeError):
    """SAP refused the call. Carries a message fit to show a person."""


class McpSap:
    """Real SAP, through the AWS for SAP MCP Server deployed in Lab 05.

    Not wired yet - Lab 05 has not been run, so there is no endpoint to call.
    Each method below maps to one OData read or write; the shapes the rest of the
    system expects are already fixed by `FakeSap`, so filling these in is the
    whole remaining integration.

    See contract/events.md for the park payload and the three traps.
    """

    def __init__(self, endpoint: str) -> None:
        self.endpoint = endpoint

    async def purchase_order(self, number: str, item: str) -> PurchaseOrder | None:
        raise NotImplementedError("Lab 05: GET A_PurchaseOrder('{number}') and to_PurchaseOrderItem")

    async def goods_receipt(self, number: str, item: str) -> GoodsReceipt | None:
        raise NotImplementedError("Lab 05: GET A_MaterialDocumentItem filtered by PurchaseOrder")

    async def reference_exists(self, vendor: str, reference: str) -> str | None:
        raise NotImplementedError(
            "Lab 05: GET A_SupplierInvoice filtered by InvoicingParty and "
            "SupplierInvoiceIDByInvcgParty"
        )

    async def open_orders_for(self, vendor: str, material: str) -> list[PurchaseOrder]:
        raise NotImplementedError("Lab 05: GET A_PurchaseOrder filtered by Supplier and Material")

    async def park(self, payload: dict) -> Parked:
        raise NotImplementedError(
            "Lab 05: POST A_SupplierInvoice with a deep insert into to_SuplrInvcItemPurOrdRef"
        )


def build_sap() -> Sap:
    if os.getenv("SAP_BACKEND", "fake") == "mcp":
        endpoint = os.environ["MCP_ENDPOINT"]
        return McpSap(endpoint)
    return FakeSap()
