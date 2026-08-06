"""One runnable check over the parts that would fail during the demo.

Run with:  python -m pytest apps/agent
Or bare:   python apps/agent/tests/test_run.py
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import events as ev  # noqa: E402
from app.extract import sample_batch  # noqa: E402
from app.judge import FakeJudge  # noqa: E402
from app.orchestrator import POSTING_DATE, RunStore, park_payload, post_run, validate_run  # noqa: E402
from app.rules import AGENT_RULE_IDS, RULE_COUNT, run_deterministic  # noqa: E402
from app.sap import FakeSap  # noqa: E402


async def collect(gen) -> list[ev.Event]:
    return [event async for event in gen]


def test_every_rule_id_is_covered_exactly_once() -> None:
    inv = sample_batch()[0]
    inv.posting_date = POSTING_DATE
    deterministic = set(run_deterministic(inv, None, None))
    covered = deterministic | AGENT_RULE_IDS
    assert covered == set(range(1, RULE_COUNT + 1)), f"missing rule ids: {set(range(1, RULE_COUNT + 1)) - covered}"
    assert not (deterministic & AGENT_RULE_IDS), "a rule cannot be both code-decided and agent-decided"


def test_business_partner_mapping_does_not_fail_valid_invoices() -> None:
    """17401710 on the invoice vs BP1710 on the order.

    Naive string equality here fails all five valid invoices - the single most
    likely way this demo dies.
    """
    sap, judge = FakeSap(), FakeJudge()
    inv = next(i for i in sample_batch() if i.vendor == "17401710")

    async def check():
        po = await sap.purchase_order(inv.purchase_order, inv.purchase_order_item)
        assert po is not None and po.supplier == "BP1710", "the fake must reproduce the real mismatch"
        return await judge.supplier_matches(inv, po)

    result = asyncio.run(check())
    assert result.passed, "the judgment layer must resolve the Business Partner mapping"
    assert result.reasoning, "an agent-decided check must carry its reasoning"


def test_full_run_is_five_ready_one_blocked() -> None:
    store, sap, judge = RunStore(), FakeSap(), FakeJudge()
    run = store.create("r_test", "516359819848", "en")
    events = asyncio.run(collect(validate_run(run, [], sap, judge)))

    approval = next(e for e in events if isinstance(e, ev.Approval))
    assert len(approval.readyIds) == 5, approval.readyIds
    assert approval.blockedIds == ["FPL-9999"], approval.blockedIds
    assert run.state == "awaiting-approval"

    blocked = next(e for e in events if isinstance(e, ev.InvoiceStatus) and e.status == "blocked")
    assert blocked.headline, "a blocked invoice must say why in plain language"

    rules = [e for e in events if isinstance(e, ev.Rule)]
    assert {r.ruleId for r in rules if r.invoiceId == "FPL-1563"} == set(range(1, RULE_COUNT + 1))
    assert any(r.decidedBy == "agent" for r in rules), "provenance must reach the wire"


def test_approval_gate_rejects_a_run_that_was_never_validated() -> None:
    store, sap = RunStore(), FakeSap()
    run = store.create("r_gate", "516359819848", "en")
    events = asyncio.run(collect(post_run(run, sap)))
    assert isinstance(events[0], ev.Error), "posting must be impossible before approval"
    assert run.state != "done"


def test_reruns_do_not_collide_on_the_invoice_reference() -> None:
    """Re-running a batch is what trips the duplicate rule during rehearsal."""
    store = RunStore()
    first = store.create("r_1", "516359819848", "en")
    second = store.create("r_2", "516359819848", "en")
    firsts = {first.reference_for(i) for i in range(6)}
    seconds = {second.reference_for(i) for i in range(6)}
    assert not (firsts & seconds), "a second run must produce fresh references"
    assert all(len(r) <= 16 for r in firsts | seconds), "SAP caps the reference at 16 characters"


def test_park_payload_parks_and_never_posts() -> None:
    store = RunStore()
    run = store.create("r_pay", "516359819848", "en")
    inv = sample_batch()[0]
    inv.reference = run.reference_for(0)
    inv.posting_date = POSTING_DATE

    payload = park_payload(inv, 0, run)
    assert payload["SupplierInvoiceStatus"] == "A", "status A parks; anything else posts for payment"
    assert payload["PostingDate"] == "2025-03-15", "the workshop books only accept an early-2025 date"
    assert payload["TaxIsCalculatedAutomatically"] is True
    assert payload["to_SuplrInvcItemPurOrdRef"][0]["PurchaseOrder"] == inv.purchase_order


if __name__ == "__main__":
    passed = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"  ok  {name}")
            passed += 1
    print(f"\n{passed} passed")
