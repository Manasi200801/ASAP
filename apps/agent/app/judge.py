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


class BedrockJudge:
    """The real one: Bedrock for judgment and explanation, SOP knowledge base for policy.

    Not wired yet. Each method takes the same inputs as FakeJudge and must return
    the same shapes, so the orchestrator and the frontend never learn the
    difference. Structured output with a retry on schema failure - a malformed
    judgement must degrade to a blocked invoice with an honest message, never to
    a silent pass.
    """

    def __init__(self, model_id: str, sop_knowledge_base_id: str | None) -> None:
        self.model_id = model_id
        self.sop_knowledge_base_id = sop_knowledge_base_id

    async def supplier_matches(self, inv: Extracted, po: PurchaseOrder | None) -> RuleResult:
        raise NotImplementedError("Read A_BusinessPartner, decide identity, return the reasoning")

    async def material_matches(self, inv: Extracted, po: PurchaseOrder | None) -> RuleResult:
        raise NotImplementedError("Compare material code and description against the order line")

    async def price_within_policy(self, inv: Extracted, po: PurchaseOrder | None) -> RuleResult:
        raise NotImplementedError("Retrieve the tolerance policy from the SOP knowledge base")

    async def explain(self, inv: Extracted, failures: list[RuleResult], locale: str) -> str:
        raise NotImplementedError("One or two sentences, business language, in the run's locale")


def build_judge() -> Judge:
    if os.getenv("JUDGE_BACKEND", "fake") == "bedrock":
        return BedrockJudge(
            model_id=os.getenv("BEDROCK_MODEL_ID", "us.anthropic.claude-sonnet-4-5-20250929-v1:0"),
            sop_knowledge_base_id=os.getenv("SOP_KNOWLEDGE_BASE_ID"),
        )
    return FakeJudge()
