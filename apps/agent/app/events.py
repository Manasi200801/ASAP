"""Mirror of `contract/events.md`.

The frontend mirrors the same shapes in Zod (`apps/web/src/lib/events.ts`).
Change the contract document first, then both sides.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel


class Event(BaseModel):
    """Base for everything on the wire. `type` is the discriminator."""

    def wire(self) -> dict[str, Any]:
        # Optional fields are dropped so the stream stays readable in devtools.
        return self.model_dump(exclude_none=True)


class Batch(Event):
    type: Literal["batch"] = "batch"
    runId: str
    reference: str
    count: int


class Invoice(Event):
    type: Literal["invoice"] = "invoice"
    invoiceId: str
    file: str
    supplierInvoiceId: str
    vendor: str
    vendorName: str | None = None
    purchaseOrder: str
    purchaseOrderItem: str | None = None
    material: str | None = None
    quantity: str | None = None
    unit: str | None = None
    unitPrice: str | None = None
    netAmount: str
    taxCode: str | None = None
    grossAmount: str | None = None
    currency: str
    companyCode: str
    confidence: dict[str, float] | None = None


class ToolCall(Event):
    type: Literal["tool-call"] = "tool-call"
    invoiceId: str | None = None
    method: str
    resource: str
    status: Literal["pending", "ok", "error"]
    ms: int | None = None


class Rule(Event):
    type: Literal["rule"] = "rule"
    invoiceId: str
    ruleId: int
    label: str
    status: Literal["pass", "fail", "skip"]
    decidedBy: Literal["rule", "agent"]
    detail: str | None = None
    evidence: str | None = None
    reasoning: str | None = None
    citation: str | None = None


class Suggestion(BaseModel):
    text: str
    action: str
    value: str


class InvoiceStatus(Event):
    type: Literal["invoice-status"] = "invoice-status"
    invoiceId: str
    status: Literal["ready", "blocked"]
    headline: str | None = None
    impact: str | None = None
    detail: str | None = None
    suggestion: Suggestion | None = None


class Summary(Event):
    type: Literal["summary"] = "summary"
    runId: str
    ready: int
    blocked: int
    rulesRun: int
    agentDecided: int
    minutesSaved: int


class Approval(Event):
    type: Literal["approval"] = "approval"
    runId: str
    readyIds: list[str]
    blockedIds: list[str]


class Posting(Event):
    type: Literal["posting"] = "posting"
    invoiceId: str
    status: Literal["parking", "parked", "error"]
    reference: str | None = None
    sapDocument: str | None = None
    fiscalYear: str | None = None
    message: str | None = None


class Text(Event):
    type: Literal["text"] = "text"
    delta: str


class Error(Event):
    type: Literal["error"] = "error"
    message: str
    recoverable: bool = False
