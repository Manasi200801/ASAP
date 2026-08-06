"""One runnable check over the parts that would fail during the demo.

Run with:  python -m pytest apps/agent
Or bare:   python apps/agent/tests/test_run.py
"""

from __future__ import annotations

import asyncio
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# A scratch database, before anything imports the app. Tests write real runs, and
# they must not land in the file the demo answers questions from.
_TEST_DB = Path(tempfile.gettempdir()) / "strike-ap-test.db"
_TEST_DB.unlink(missing_ok=True)
os.environ["AP_DB_PATH"] = str(_TEST_DB)

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
    # OData V2 epoch-millisecond form for 2025-03-15, the only open posting
    # period on the workshop system. A plain date string fails at write time.
    assert payload["PostingDate"] == "/Date(1741996800000)/", payload["PostingDate"]
    assert payload["DocumentDate"] == payload["PostingDate"]
    assert payload["TaxIsCalculatedAutomatically"] is True
    assert payload["to_SuplrInvcItemPurOrdRef"][0]["PurchaseOrder"] == inv.purchase_order


def test_the_same_invoice_twice_in_one_batch_is_blocked() -> None:
    """The duplicate SAP cannot catch.

    Neither copy has been parked, and each row is given its own fresh reference,
    so every check passes on both and the supplier is paid twice.
    """
    from app.orchestrator import mark_duplicates
    from app.rules import not_duplicate

    original, repeat = sample_batch()[0], sample_batch()[0]
    # The same invoice forwarded twice arrives under a different file name, which
    # is why identity is the supplier and their invoice number, not the file.
    repeat.file = "forwarded-again.pdf"
    batch = [original, repeat]

    mark_duplicates(batch)

    assert original.duplicate_of is None, "the first copy is not a duplicate of anything"
    assert repeat.duplicate_of == original.file, "the repeat names the file it repeats"

    assert not_duplicate(original, None, None).passed, "the original must still pass rule 16"
    verdict = not_duplicate(repeat, None, None)
    assert not verdict.passed, "the repeat must fail rule 16"
    assert original.file in (verdict.detail or ""), "the reason must name the earlier file"


def test_distinct_invoices_from_one_supplier_are_not_duplicates() -> None:
    """Four of the demo invoices share a supplier. None of them repeat."""
    from app.orchestrator import mark_duplicates

    batch = sample_batch()
    mark_duplicates(batch)
    assert all(i.duplicate_of is None for i in batch), "distinct invoices must not be flagged"


def test_the_agent_can_query_what_a_run_wrote() -> None:
    """The chat answers from the database, through exactly these three tools.

    Nothing about the batch is put in the prompt, so if these queries are wrong
    the assistant is not wrong in an interesting way - it is blind.
    """
    from decimal import Decimal

    from app.ask import dispatch

    store, sap, judge = RunStore(), FakeSap(), FakeJudge()
    run = store.create("r_tools", "516359819848", "en")
    asyncio.run(collect(validate_run(run, [], sap, judge)))

    detail = dispatch("invoice_detail", {"invoice": "FPL-9999"})
    assert detail["verdict"] == "blocked", detail
    assert detail["headline"], "the reason a person reads must survive to the database"
    assert any(not check["passed"] for check in detail["checks"]), "the failing check must be there"
    assert any(check["decided_by"] == "agent" for check in detail["checks"]), "provenance too"

    missing = dispatch("invoice_detail", {"invoice": "FPL-0000"})
    assert missing.get("found") is False, "an unknown invoice is answerable, not an error"

    supplier = dispatch("search_invoices", {"query": "17401710"})
    assert supplier["count"] >= 4, supplier["count"]

    # Asked for a full breakdown, the model sends a single space. LIKE '% %'
    # matches only fields containing a space, which reads back as an empty batch.
    assert dispatch("search_invoices", {"query": " "})["count"] == 6
    assert dispatch("search_invoices", {})["count"] == 6

    blocked = dispatch("search_invoices", {"status": "blocked"})
    assert [row["invoice_id"] for row in blocked["invoices"]] == ["FPL-9999"]

    # The arithmetic the model got wrong on its own: 454.00 for a batch of 513.50.
    totals = dispatch("batch_totals", {"status": "ready"})
    expected = sum(Decimal(i.gross_amount) for i in run.invoices if i.invoice_id in run.ready)
    assert Decimal(totals["gross_total"]) == expected, totals
    assert totals["ready"] == 5 and totals["blocked"] == 0, totals


def test_a_question_survives_the_process_that_ran_the_batch() -> None:
    """The store is in memory; the answers are not.

    A reload used to be answered with "I no longer have that batch", which is a
    demo ending itself.
    """
    from app.ask import dispatch

    store, sap, judge = RunStore(), FakeSap(), FakeJudge()
    run = store.create("r_gone", "516359819848", "en")
    asyncio.run(collect(validate_run(run, [], sap, judge)))

    restarted = RunStore()  # everything the old process held is gone
    assert restarted.get("r_gone") is None

    detail = dispatch("invoice_detail", {"invoice": "FPL-9999", "run": "r_gone"})
    assert detail and detail["verdict"] == "blocked"


def test_a_half_finished_turn_cannot_break_the_next_question() -> None:
    """Stored history is not guaranteed to alternate, and Converse requires it.

    An answer that failed mid-stream leaves a question with no reply. Sending
    that back verbatim is a validation error from Bedrock, which surfaces as the
    entire chat breaking rather than as one lost turn.
    """
    from app import db
    from app.ask import conversation

    db.add_message("s_broken", "user", "why was FPL-9999 blocked?")
    db.add_message("s_broken", "user", "hello? the answer never arrived")
    db.add_message("s_broken", "assistant", "sorry - the purchase order is missing.")

    past = db.history("s_broken")
    assert [turn["role"] for turn in past] == ["user", "user", "assistant"]

    messages = conversation(past, "and the others?")
    roles = [message["role"] for message in messages]
    assert roles == ["user", "assistant", "user"], roles
    assert "hello?" in messages[0]["content"][0]["text"], "a merged turn keeps both questions"

    # History trimmed to a window can also begin on an answer, which Converse
    # rejects just as firmly.
    opening = conversation([{"role": "assistant", "text": "...continued"}], "hi")
    assert [message["role"] for message in opening] == ["user"]


def test_the_prompt_is_written_the_way_the_answer_must_read() -> None:
    """Prompt style leaks into answer style, and this answer is rendered as raw text.

    A markdown bullet in the prompt is how an asterisk ends up on a clerk's
    screen. The language placeholder is checked here too: forgetting to
    substitute it would ship the literal word to the model.
    """
    from app.ask import SYSTEM, TOOLS, answer  # noqa: F401

    assert "**" not in SYSTEM and "##" not in SYSTEM, "no markdown emphasis or headings"
    offenders = [
        line for line in SYSTEM.splitlines() if line.lstrip().startswith(("- ", "* ", "#", "1. "))
    ]
    assert not offenders, offenders

    assert "LANGUAGE" in SYSTEM, "the language placeholder must survive edits"
    assert SYSTEM.replace("LANGUAGE", "German").count("LANGUAGE") == 0

    # "By far the most important factor in tool performance" - and one-sentence
    # descriptions are what the model had before.
    for tool in TOOLS:
        description = tool["toolSpec"]["description"]
        assert description.count(". ") >= 3, tool["toolSpec"]["name"]


def test_the_conversation_outlives_the_batch() -> None:
    """History used to live on the Run, so a second batch wiped it mid-conversation."""
    from app import db

    db.add_message("s_keep", "user", "what is blocked?", run_id="r_one")
    db.add_message("s_keep", "assistant", "FPL-9999.", run_id="r_one")
    db.add_message("s_keep", "user", "and in this new batch?", run_id="r_two")

    kept = db.history("s_keep")
    assert len(kept) == 3, "a new run must not truncate the conversation"
    assert db.history("s_other") == [], "sessions do not leak into each other"


if __name__ == "__main__":
    passed = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"  ok  {name}")
            passed += 1
    print(f"\n{passed} passed")
