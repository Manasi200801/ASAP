"""SAP access, behind one seam.

`FakeSap` lets the whole orchestrator run today, before Lab 05 deploys the AWS
for SAP MCP Server. `McpSap` is the only thing that changes once it exists -
every rule, every event and the entire frontend stay untouched.

Swap with SAP_BACKEND=mcp.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from typing import Protocol

from .types import GoodsReceipt, Parked, PurchaseOrder

log = logging.getLogger("app.sap")

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


def _odata_error(document: dict) -> str | None:
    """Dig SAP's own words out of an OData V2 error body.

    Shape:

        {"error": {"code": "...",
                   "message": {"lang": "en", "value": "the headline"},
                   "innererror": {"errordetails": [{"message": "the specifics"}]}}}

    The headline is often generic ("An exception was raised") while
    `errordetails` carries the line that actually says what is wrong, so both are
    reported. Returns None when the document is not an error at all.
    """
    error = document.get("error")
    if not isinstance(error, dict):
        return None

    message = error.get("message")
    if isinstance(message, dict):
        headline = message.get("value", "")
    else:
        headline = message if isinstance(message, str) else ""

    details: list[str] = []
    inner = error.get("innererror")
    if isinstance(inner, dict):
        for detail in inner.get("errordetails") or []:
            if not isinstance(detail, dict):
                continue
            text = detail.get("message", "")
            # SAP repeats the headline as the first detail more often than not.
            if text and text != headline and text not in details:
                details.append(text)

    parts = [p for p in [headline, *details] if p]
    if not parts and error.get("code"):
        return f"SAP rejected the write ({error['code']})."
    return " ".join(parts) or None


class McpSap:
    """Real SAP, through the MCP server running on Bedrock AgentCore.

    The chain is: Cognito client-credentials token -> AgentCore invocation
    endpoint -> MCP `tools/call` -> `invoke_sap_odata_service` -> SAP OData.

    The server exposes one generic tool that takes a full OData URL, so every
    method here is really just URL construction plus parsing OData V2, which
    wraps single entities in `d` and collections in `d.results`.
    """

    TOOL = "invoke_sap_odata_service"
    COGNITO_SECRET = "sap_mcp_server/cognito/oauth2_config"
    ARN_PARAMETER = "/sap_mcp_server/runtime/agent_arn"

    def __init__(self, base_url: str, region: str = "us-east-1") -> None:
        self.base_url = base_url.rstrip("/")
        self.region = region
        self._token: str | None = None
        self._token_expires = 0.0
        self._agent_arn: str | None = None
        self._cognito: dict | None = None

    # --- plumbing ---------------------------------------------------------

    def _config(self) -> tuple[str, dict]:
        """Agent ARN and Cognito config, read once and kept."""
        import boto3

        if self._agent_arn is None:
            arn = os.getenv("AGENT_RUNTIME_ARN")
            if not arn:
                ssm = boto3.client("ssm", region_name=self.region)
                arn = ssm.get_parameter(Name=self.ARN_PARAMETER)["Parameter"]["Value"]
            self._agent_arn = arn

        if self._cognito is None:
            secrets = boto3.client("secretsmanager", region_name=self.region)
            raw = secrets.get_secret_value(SecretId=self.COGNITO_SECRET)["SecretString"]
            self._cognito = json.loads(raw)

        return self._agent_arn, self._cognito

    def _bearer(self) -> str:
        """Cached client-credentials token. Refreshed a minute before expiry."""
        import requests

        if self._token and time.time() < self._token_expires - 60:
            return self._token

        _, cognito = self._config()
        resource = cognito["resource_server_id"]
        response = requests.post(
            cognito["token_endpoint"],
            data={
                "grant_type": "client_credentials",
                "client_id": cognito["client_credentials_id"],
                "client_secret": cognito["client_credentials_secret"],
                "scope": f"{resource}/read {resource}/write",
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=30,
        )
        if response.status_code != 200:
            raise SapError("Could not authenticate against SAP.")

        body = response.json()
        self._token = body["access_token"]
        self._token_expires = time.time() + int(body.get("expires_in", 3600))
        return self._token

    def _invoke(self, url: str, method: str = "GET", body: dict | None = None) -> dict:
        """One MCP tools/call. Blocking - callers wrap it in a thread."""
        import requests

        started = time.perf_counter()

        agent_arn, _ = self._config()
        encoded = agent_arn.replace(":", "%3A").replace("/", "%2F")
        endpoint = (
            f"https://bedrock-agentcore.{self.region}.amazonaws.com"
            f"/runtimes/{encoded}/invocations?qualifier=DEFAULT"
        )

        arguments: dict = {"odata_api_url": url, "http_method": method}
        if body is not None:
            arguments["request_body"] = json.dumps(body)

        response = requests.post(
            endpoint,
            headers={
                "authorization": f"Bearer {self._bearer()}",
                "Content-Type": "application/json",
                "Accept": "application/json, text/event-stream",
            },
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {"name": self.TOOL, "arguments": arguments},
            },
            timeout=120,
        )
        ms = (time.perf_counter() - started) * 1000
        # The entity, not the whole URL - the base path is the same every time and
        # only the tail says which object was read.
        entity = url.rsplit("/", 1)[-1][:90]
        if response.status_code != 200:
            log.error("%s %s -> HTTP %d in %.0fms", method, entity, response.status_code, ms)
            raise SapError(f"SAP is not responding ({response.status_code}).")

        log.info("%s %s -> ok in %.0fms", method, entity, ms)
        return self._unwrap(response.text)

    @staticmethod
    def _unwrap(raw: str) -> dict:
        """Pull the OData payload out of the SSE-framed JSON-RPC response."""
        payload = None
        for line in raw.splitlines():
            if line.startswith("data:"):
                payload = json.loads(line[5:].strip())
        if payload is None:
            payload = json.loads(raw)

        if "error" in payload:
            raise SapError(payload["error"].get("message", "SAP call failed."))

        result = payload.get("result", {})
        blocks = result.get("content", [])
        text = blocks[0].get("text", "") if blocks else ""

        if result.get("isError"):
            raise SapError(text or "SAP rejected the call.")

        try:
            document = json.loads(text)
        except json.JSONDecodeError:
            # Some writes answer with a bare status line rather than a document.
            return {"raw": text}

        # A rejected write comes back as a 200 carrying an OData error body, not
        # as a transport failure. Read as a document it simply has no `d`, which
        # is how a real complaint - "tax code V0 is not defined for country DE" -
        # turned into "SAP did not return a document number."
        complaint = _odata_error(document)
        if complaint:
            raise SapError(complaint)

        return document

    async def _get(self, url: str) -> dict:
        return await asyncio.to_thread(self._invoke, url, "GET", None)

    @staticmethod
    def _entity(document: dict) -> dict | None:
        d = document.get("d")
        if not isinstance(d, dict):
            return None
        return d

    @staticmethod
    def _rows(document: dict) -> list[dict]:
        d = document.get("d")
        if isinstance(d, dict):
            results = d.get("results")
            if isinstance(results, list):
                return results
            return [d]
        return []

    # --- the five reads and one write -------------------------------------

    async def purchase_order(self, number: str, item: str) -> PurchaseOrder | None:
        url = (
            f"{self.base_url}/API_PURCHASEORDER_PROCESS_SRV/A_PurchaseOrder('{number}')"
            "?$expand=to_PurchaseOrderItem"
        )
        try:
            entity = self._entity(await self._get(url))
        except SapError:
            # A missing purchase order is the headline exception this whole
            # system exists to catch, not an outage. Report it as absent.
            return None
        if entity is None:
            return None

        items = entity.get("to_PurchaseOrderItem", {})
        rows = items.get("results", []) if isinstance(items, dict) else []
        line = next((r for r in rows if r.get("PurchaseOrderItem") == item), None)

        return PurchaseOrder(
            number=number,
            item=line.get("PurchaseOrderItem") if line else None,
            company_code=entity.get("CompanyCode", ""),
            currency=entity.get("DocumentCurrency", ""),
            supplier=entity.get("Supplier", ""),
            material=line.get("Material") if line else None,
            open_quantity=line.get("OrderQuantity") if line else None,
            net_price=line.get("NetPriceAmount") if line else None,
            tax_code=line.get("TaxCode") if line else None,
            blocked=bool(line.get("PurchasingDocumentDeletionCode")) if line else False,
            fully_invoiced=bool(line.get("IsFinallyInvoiced")) if line else False,
            gr_based_invoicing=bool(line.get("IsGoodsReceiptBased", True)) if line else True,
        )

    async def goods_receipt(self, number: str, item: str) -> GoodsReceipt | None:
        url = (
            f"{self.base_url}/API_MATERIAL_DOCUMENT_SRV/A_MaterialDocumentItem"
            f"?$filter=PurchaseOrder eq '{number}' and PurchaseOrderItem eq '{item}'"
            " and GoodsMovementType eq '101'"
        )
        try:
            rows = self._rows(await self._get(url))
        except SapError:
            return None
        if not rows:
            return None

        received = sum(float(r.get("QuantityInEntryUnit", 0) or 0) for r in rows)
        return GoodsReceipt(document=rows[0].get("MaterialDocument", ""), quantity=str(received))

    async def reference_exists(self, vendor: str, reference: str) -> str | None:
        url = (
            f"{self.base_url}/API_SUPPLIERINVOICE_PROCESS_SRV/A_SupplierInvoice"
            f"?$filter=InvoicingParty eq '{vendor}'"
            f" and SupplierInvoiceIDByInvcgParty eq '{reference}'"
        )
        try:
            rows = self._rows(await self._get(url))
        except SapError:
            return None
        return rows[0].get("SupplierInvoice") if rows else None

    async def open_orders_for(self, vendor: str, material: str) -> list[PurchaseOrder]:
        url = (
            f"{self.base_url}/API_PURCHASEORDER_PROCESS_SRV/A_PurchaseOrderItem"
            f"?$filter=Material eq '{material}' and IsFinallyInvoiced eq false"
            "&$top=5"
        )
        try:
            rows = self._rows(await self._get(url))
        except SapError:
            return []

        found = []
        for row in rows:
            number = row.get("PurchaseOrder")
            if not number:
                continue
            order = await self.purchase_order(number, row.get("PurchaseOrderItem", "10"))
            if order and order.supplier and vendor.endswith(order.supplier[-4:]):
                found.append(order)
        return found

    async def park(self, payload: dict) -> Parked:
        url = f"{self.base_url}/API_SUPPLIERINVOICE_PROCESS_SRV/A_SupplierInvoice"
        document = await asyncio.to_thread(self._invoke, url, "POST", payload)

        entity = self._entity(document)
        if entity is None or not entity.get("SupplierInvoice"):
            # `_unwrap` already raises on a recognised OData error, so reaching
            # here means a shape nobody anticipated. Log it whole - a generic
            # sentence with the evidence thrown away costs an entire re-run to
            # learn anything, which is exactly what happened.
            log.error("park returned no document number: %s", json.dumps(document)[:2000])
            raise SapError(
                document.get("raw")
                or "SAP accepted the call but returned no document number. "
                "The agent log has the full response."
            )

        return Parked(
            sap_document=entity["SupplierInvoice"],
            fiscal_year=entity.get("FiscalYear", ""),
        )


def build_sap() -> Sap:
    if os.getenv("SAP_BACKEND", "fake") == "mcp":
        return McpSap(
            base_url=os.environ["SAP_BASE_URL"],
            region=os.getenv("AWS_REGION", "us-east-1"),
        )
    return FakeSap()
