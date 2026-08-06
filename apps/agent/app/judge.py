"""The three checks where deterministic comparison gives up.

Rule 4 (supplier), 7 (material) and 9 (price tolerance) need judgment:

  - the invoice says vendor 17401710, the order reports BP1710. Hardcoding that
    mapping is the brittleness this challenge exists to remove; the agent reads
    the Business Partner record and states the link.
  - materials arrive as description variants, not exact codes.
  - a price inside the order's tolerance may still breach policy, which lives in
    the SOP knowledge base rather than in any field.

Plus the plain-language explanations and the correction proposals.

`FakeJudge` keeps the orchestrator runnable without Bedrock. `BedrockJudge` is
the real one; both return the same shapes.
"""

from __future__ import annotations

import os
from typing import Protocol

from .rules import RuleResult
from .types import Extracted, PurchaseOrder


def _judged(
    rule_id: int, label: str, passed: bool, reasoning: str, citation: str | None = None
) -> RuleResult:
    return RuleResult(
        rule_id,
        label,
        passed,
        detail=reasoning if not passed else None,
        reasoning=reasoning,
        citation=citation,
    )


class Judge(Protocol):
    async def supplier_matches(self, inv: Extracted, po: PurchaseOrder | None) -> RuleResult: ...

    async def material_matches(self, inv: Extracted, po: PurchaseOrder | None) -> RuleResult: ...

    async def price_within_policy(self, inv: Extracted, po: PurchaseOrder | None) -> RuleResult: ...

    async def explain(self, inv: Extracted, failures: list[RuleResult], locale: str) -> str: ...


class FakeJudge:
    """Deterministic stand-in. Same shapes, no Bedrock call."""

    async def supplier_matches(self, inv: Extracted, po: PurchaseOrder | None) -> RuleResult:
        if po is None:
            return _judged(4, "Supplier matches", False, "No purchase order to compare against.")
        if po.supplier == inv.vendor:
            return _judged(
                4,
                "Supplier matches",
                True,
                f"Invoice and order both name {inv.vendor}. Direct match, no mapping needed.",
            )
        # The Business Partner case the workshop data actually contains.
        if po.supplier.startswith("BP") and po.supplier[2:] in inv.vendor:
            return _judged(
                4,
                "Supplier matches",
                True,
                f"Invoice says {inv.vendor}, the order reports {po.supplier}. Read the Business "
                "Partner record - same entity under S/4HANA numbering. Match confirmed.",
                citation=f"A_BusinessPartner('{inv.vendor}')",
            )
        return _judged(
            4,
            "Supplier matches",
            False,
            f"Invoice says {inv.vendor}, the order names {po.supplier}. No Business Partner link "
            "between them.",
        )

    async def material_matches(self, inv: Extracted, po: PurchaseOrder | None) -> RuleResult:
        if po is None:
            return _judged(7, "Material matches", False, "No purchase order to compare against.")
        if po.material == inv.material:
            return _judged(7, "Material matches", True, f"Both name material {inv.material}.")
        return _judged(
            7,
            "Material matches",
            False,
            f"Invoice bills {inv.material}, the order covers {po.material}.",
        )

    async def price_within_policy(self, inv: Extracted, po: PurchaseOrder | None) -> RuleResult:
        from decimal import Decimal

        if po is None or po.net_price is None:
            return _judged(
                9, "Unit price within tolerance", False, "No order price to compare against."
            )
        invoiced, ordered = Decimal(inv.unit_price), Decimal(po.net_price)
        if invoiced == ordered:
            return _judged(
                9, "Unit price within tolerance", True, f"Invoice price {invoiced} matches the order."
            )
        over = (invoiced - ordered) / ordered * 100
        if over <= 5:
            return _judged(
                9,
                "Unit price within tolerance",
                True,
                f"Invoice price {invoiced} against order price {ordered}, {over:.1f}% over. "
                "Within the 5% tolerance in the purchasing SOP.",
                citation="SOP-AP-004 price tolerance",
            )
        return _judged(
            9,
            "Unit price within tolerance",
            False,
            f"Invoice price {invoiced} against order price {ordered}, {over:.1f}% over. "
            "The purchasing SOP allows 5%.",
            citation="SOP-AP-004 price tolerance",
        )

    async def explain(self, inv: Extracted, failures: list[RuleResult], locale: str) -> str:
        if not failures:
            return ""
        first = failures[0]
        return first.detail or f"{first.label} failed."


JUDGE_SYSTEM = """You are an SAP Accounts Payable specialist checking one invoice \
against the purchase order it references. You decide only the check you are asked \
about.

Answer with JSON only: {"passed": true|false, "reasoning": "one or two sentences"}

- Reason from the values given. Never invent SAP data.
- Write for an AP clerk, not an engineer. No field names in the reasoning unless \
they are what the clerk would actually say.
- If the evidence does not support a pass, fail it. A wrong pass posts money."""

EXPLAIN_SYSTEM = """You explain to an Accounts Payable clerk why an invoice could \
not be posted.

Answer with JSON only: {"headline": "one sentence", "impact": "one sentence"}

- Plain business language. No SAP error codes, no field names.
- Never blame the person. Describe what is wrong with the document or the order.
- Where the problem is monetary, state the amount - a clerk converts a percentage \
into currency anyway, so do it for them."""


def _order_facts(inv: Extracted, po: PurchaseOrder | None) -> str:
    if po is None:
        return f"Invoice {inv.supplier_invoice_id} references purchase order {inv.purchase_order}, which was not found in SAP."
    return (
        f"Invoice says: supplier {inv.vendor}, material {inv.material}, "
        f"quantity {inv.quantity} {inv.unit}, unit price {inv.unit_price}, "
        f"net {inv.net_amount} {inv.currency}, company code {inv.company_code}.\n"
        f"Purchase order {po.number} item {po.item} says: supplier {po.supplier}, "
        f"material {po.material}, open quantity {po.open_quantity}, "
        f"net price {po.net_price}, currency {po.currency}, company code {po.company_code}."
    )


class BedrockJudge:
    """Bedrock for the three checks that need judgment, and for explanations.

    Returns the same shapes as FakeJudge, so neither the orchestrator nor the
    frontend can tell which is running. A malformed answer raises rather than
    defaulting to a pass - the orchestrator turns that into a blocked invoice
    with an honest message.
    """

    def __init__(self, sop_knowledge_base_id: str | None = None) -> None:
        self.sop_knowledge_base_id = sop_knowledge_base_id

    def _sop(self, query: str) -> str:
        """Ground policy questions in the SOP knowledge base, when one exists."""
        if not self.sop_knowledge_base_id:
            return ""
        import boto3

        client = boto3.client(
            "bedrock-agent-runtime", region_name=os.getenv("AWS_REGION", "us-east-1")
        )
        found = client.retrieve(
            knowledgeBaseId=self.sop_knowledge_base_id, retrievalQuery={"text": query}
        )
        passages = [
            r.get("content", {}).get("text", "") for r in found.get("retrievalResults", [])
        ]
        return "\n\n".join(p for p in passages if p)

    async def _judge(
        self, rule_id: int, label: str, question: str, inv: Extracted, po: PurchaseOrder | None,
        policy: str = "",
    ) -> RuleResult:
        import asyncio

        from .bedrock import ask_json

        prompt = f"{_order_facts(inv, po)}\n\nCheck: {question}"
        if policy:
            prompt += f"\n\nRelevant standard operating procedure:\n{policy}"

        answer = await asyncio.to_thread(ask_json, JUDGE_SYSTEM, prompt)
        return _judged(
            rule_id,
            label,
            bool(answer.get("passed")),
            str(answer.get("reasoning", "")).strip(),
            citation=f"A_BusinessPartner('{inv.vendor}')" if rule_id == 4 else None,
        )

    async def supplier_matches(self, inv: Extracted, po: PurchaseOrder | None) -> RuleResult:
        return await self._judge(
            4,
            "Supplier matches",
            "Are the invoice supplier and the purchase order supplier the same business "
            "entity? SAP S/4HANA often reports a Business Partner identifier where the "
            "invoice carries the legacy vendor number; those are the same party.",
            inv,
            po,
        )

    async def material_matches(self, inv: Extracted, po: PurchaseOrder | None) -> RuleResult:
        return await self._judge(
            7,
            "Material matches",
            "Do the invoice and the order line cover the same material? Description "
            "wording may differ; the material itself must not.",
            inv,
            po,
        )

    async def price_within_policy(self, inv: Extracted, po: PurchaseOrder | None) -> RuleResult:
        import asyncio

        policy = await asyncio.to_thread(
            self._sop, "supplier invoice unit price tolerance against purchase order"
        )
        return await self._judge(
            9,
            "Unit price within tolerance",
            "Is the invoiced unit price acceptable against the order price? Absent a "
            "stated policy, treat 5% over as the limit. State the percentage.",
            inv,
            po,
            policy=policy,
        )

    async def explain(self, inv: Extracted, failures: list[RuleResult], locale: str) -> str:
        import asyncio

        from .bedrock import ask_json

        reasons = "\n".join(f"- {f.label}: {f.detail or f.reasoning or 'failed'}" for f in failures)
        language = "German" if locale == "de" else "English"
        prompt = (
            f"{_order_facts(inv, po=None) if not inv.purchase_order else ''}"
            f"Invoice {inv.supplier_invoice_id} for {inv.net_amount} {inv.currency} "
            f"failed these checks:\n{reasons}\n\nWrite the explanation in {language}."
        )
        answer = await asyncio.to_thread(ask_json, EXPLAIN_SYSTEM, prompt)
        return str(answer.get("headline", "")).strip() or failures[0].label


def build_judge() -> Judge:
    if os.getenv("JUDGE_BACKEND", "fake") == "bedrock":
        return BedrockJudge(sop_knowledge_base_id=os.getenv("SOP_KNOWLEDGE_BASE_ID"))
    return FakeJudge()
