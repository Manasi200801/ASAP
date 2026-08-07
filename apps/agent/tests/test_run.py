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
from app.sap import FakeSap, SapError  # noqa: E402
from app.storage import FakeMover, blocked_bucket, processed_bucket, upload_bucket  # noqa: E402


async def collect(gen) -> list[ev.Event]:
    return [event async for event in gen]


async def settled(sap=None, overrides=None, rejects=None) -> tuple[list[ev.Event], FakeMover]:
    """Validate the sample batch, then approve it, and report what moved.

    Every invoice is given a source in the upload bucket, which extraction sets
    for real. Without one the mover has nothing to file and every routing
    assertion below would pass vacuously.
    """
    store, judge, mover = RunStore(), FakeJudge(), FakeMover()
    sap = sap or FakeSap()
    run = store.create("r_file", "516359819848", "en")

    await collect(validate_run(run, [], sap, judge))
    for inv in run.invoices:
        inv.source = f"s3://{upload_bucket()}/runs/r_file/{inv.file}"

    events = await collect(post_run(run, sap, mover, overrides, rejects))
    return events, mover


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
    events = asyncio.run(collect(post_run(run, sap, FakeMover())))
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
    # OData V2 epoch-millisecond form for 2025-03-15, the only open posting
    # period on the workshop system. A plain date string fails at write time.
    assert payload["PostingDate"] == "/Date(1741996800000)/", payload["PostingDate"]
    assert payload["DocumentDate"] == payload["PostingDate"]
    assert payload["TaxIsCalculatedAutomatically"] is True
    assert payload["to_SuplrInvcItemPurOrdRef"][0]["PurchaseOrder"] == inv.purchase_order


def test_parked_invoices_are_filed_and_blocked_ones_are_left_alone() -> None:
    """The upload bucket must end up holding only what is still undecided."""
    events, mover = asyncio.run(settled())

    filed = {e.invoiceId: e for e in events if isinstance(e, ev.Filed)}
    assert len(filed) == 5, "the five clean invoices should be filed"
    assert all(e.bucket == processed_bucket() for e in filed.values())
    assert all(e.status == "moved" for e in filed.values()), "the original must be deleted"

    # Blocked, and nobody said anything about it. It stays put.
    assert "FPL-9999" not in filed
    assert all(source.endswith("fpl-invoice-06.pdf") is False for source, _, _ in mover.moves)


def test_an_override_is_posted_and_filed_as_processed() -> None:
    """A human overturning the AI's block is a real approval, not a reclassification."""
    events, _ = asyncio.run(settled(overrides=["FPL-9999"]))

    posting = next(e for e in events if isinstance(e, ev.Posting) and e.invoiceId == "FPL-9999")
    assert posting.status == "parked", "the override must actually reach SAP"

    filed = next(e for e in events if isinstance(e, ev.Filed) and e.invoiceId == "FPL-9999")
    assert filed.bucket == processed_bucket()


def test_an_override_sap_refuses_stays_in_the_upload_bucket() -> None:
    """Nobody rejected it, and a retry may work. Filing it as blocked invents a verdict."""

    class RefusingSap(FakeSap):
        async def park(self, payload: dict):
            raise SapError("purchase order 4500009999 does not exist")

    events, mover = asyncio.run(settled(sap=RefusingSap(), overrides=["FPL-9999"]))

    assert all(e.status == "error" for e in events if isinstance(e, ev.Posting))
    assert not [e for e in events if isinstance(e, ev.Filed)], "a refused park files nothing"
    assert mover.moves == []


def test_an_explicit_rejection_is_filed_as_blocked() -> None:
    events, _ = asyncio.run(settled(rejects=["FPL-9999"]))

    filed = next(e for e in events if isinstance(e, ev.Filed) and e.invoiceId == "FPL-9999")
    assert filed.bucket == blocked_bucket()
    assert not [e for e in events if isinstance(e, ev.Posting) and e.invoiceId == "FPL-9999"], (
        "a rejected invoice must never reach SAP"
    )


def test_the_workshop_bucket_is_copied_from_but_never_emptied() -> None:
    """`Load batch` reads these six. Deleting one destroys the demo fallback for the account."""

    async def run_it() -> tuple[list[ev.Event], FakeMover]:
        store, sap, judge, mover = RunStore(), FakeSap(), FakeJudge(), FakeMover()
        run = store.create("r_ws", "516359819848", "en")
        await collect(validate_run(run, [], sap, judge))
        for inv in run.invoices:
            inv.source = f"s3://516359819848-invoice/{inv.file}"
        return await collect(post_run(run, sap, mover, None, None)), mover

    events, mover = asyncio.run(run_it())

    assert mover.moves, "the archive copy must still happen"
    assert all(not deleted for _, _, deleted in mover.moves), "nothing outside uploads is deleted"
    assert all(e.status == "kept" for e in events if isinstance(e, ev.Filed))


def test_sample_mode_files_nothing() -> None:
    """No source URI means no object to move, and guessing one deletes the wrong file."""

    async def run_it() -> FakeMover:
        store, sap, judge, mover = RunStore(), FakeSap(), FakeJudge(), FakeMover()
        run = store.create("r_sample", "516359819848", "en")
        await collect(validate_run(run, [], sap, judge))  # sample batch: source stays ""
        await collect(post_run(run, sap, mover, None, None))
        return mover

    assert asyncio.run(run_it()).moves == []


if __name__ == "__main__":
    passed = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"  ok  {name}")
            passed += 1
    print(f"\n{passed} passed")
