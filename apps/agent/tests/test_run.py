"""One runnable check over the parts that would fail during the demo.

Run with:  python -m pytest apps/agent
Or bare:   python apps/agent/tests/test_run.py
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import os
import sys
import tempfile
from contextlib import closing
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
from app.orchestrator import (  # noqa: E402
    POSTING_DATE,
    Run,
    RunStore,
    park_payload,
    post_run,
    validate_run,
)
from app.rules import AGENT_RULE_IDS, RULE_COUNT, run_deterministic  # noqa: E402
from app.sap import FakeSap, McpSap, SapError  # noqa: E402
from app.storage import FakeMover, blocked_bucket, processed_bucket, upload_bucket  # noqa: E402


async def collect(gen) -> list[ev.Event]:
    return [event async for event in gen]


async def settled(
    sap=None, overrides=None, rejects=None, ids=None
) -> tuple[list[ev.Event], FakeMover]:
    """Validate the sample batch, then approve it, and report what moved.

    Every invoice is given a source in the upload bucket, which extraction sets
    for real. Without one the mover has nothing to file and every routing
    assertion below would pass vacuously.

    In its own database, because it parks: posting now writes the run, so
    sharing a file would make the sample batch permanently "already parked" for
    every later test that expects a clean slate.
    """
    with its_own_database():
        store, judge, mover = RunStore(), FakeJudge(), FakeMover()
        sap = sap or FakeSap()
        run = store.create("r_file", "516359819848", "en")

        # Asked for by name: an empty key list is an empty batch now, not the sample.
        await collect(validate_run(run, [], sap, judge, sample=True))
        for inv in run.invoices:
            inv.source = f"s3://{upload_bucket()}/runs/r_file/{inv.file}"

        events = await collect(post_run(run, sap, mover, overrides, rejects, ids=ids))
        return events, mover


@contextlib.contextmanager
def its_own_database():
    """For a test that parks documents.

    Parking is remembered forever, on purpose - so a test that parks the sample
    batch makes every later run of it a real duplicate. That is the behaviour
    working; it just cannot share a file with the tests that expect a clean slate.
    """
    previous = os.environ["AP_DB_PATH"]
    scratch = Path(tempfile.gettempdir()) / "strike-ap-parked.db"
    scratch.unlink(missing_ok=True)
    os.environ["AP_DB_PATH"] = str(scratch)
    try:
        yield
    finally:
        os.environ["AP_DB_PATH"] = previous


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

    # A live park produced 516359819848-521 - already all sixteen characters. A
    # sequence that simply grows reaches four digits within a few runs and SAP
    # rejects the batch mid-demo. Seed at the top of the range and rehearse hard.
    store._next_sequence = 890
    for _ in range(40):
        run = store.create(f"r_{_}", "516359819848", "en")
        references = [run.reference_for(i) for i in range(10)]
        assert all(len(r) <= 16 for r in references), references


def test_park_payload_parks_and_never_posts() -> None:
    store = RunStore()
    run = store.create("r_pay", "516359819848", "en")
    inv = sample_batch()[0]
    inv.reference = run.reference_for(0)
    inv.posting_date = POSTING_DATE

    inv.gr_document, inv.gr_year, inv.gr_item = "5000002033", "2025", "1"

    payload = park_payload(inv, 0, run)
    assert payload["SupplierInvoiceStatus"] == "A", "status A parks; anything else posts for payment"

    # SAP rejects the whole document without these wherever the order settles
    # against goods receipts: "Fill in mandatory field 'ReferenceDocument,
    # -FiscalYear, -Item'". Four of five invoices failed to park on exactly this.
    line = payload["to_SuplrInvcItemPurOrdRef"][0]
    assert line["ReferenceDocument"] == "5000002033", line
    assert line["ReferenceDocumentFiscalYear"] == "2025", line
    assert line["ReferenceDocumentItem"] == "1", line

    # With no receipt in hand the fields are omitted rather than sent empty - an
    # invoice with no goods receipt has to fail its own check, not the payload.
    bare = sample_batch()[0]
    bare.reference, bare.posting_date = run.reference_for(1), POSTING_DATE
    assert "ReferenceDocument" not in park_payload(bare, 1, run)["to_SuplrInvcItemPurOrdRef"][0]
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


def test_a_refusal_is_reported_to_the_person_not_just_the_log() -> None:
    """"0 parked" and nothing else describes an empty batch, not a rejected one."""

    class RefusingSap(FakeSap):
        async def park(self, payload: dict):
            raise SapError("Reference 516359819848-55 already exists for supplier 17401710")

    events, _ = asyncio.run(settled(sap=RefusingSap()))

    failures = [e for e in events if isinstance(e, ev.Posting) and e.status == "error"]
    assert len(failures) == 5, "every refused invoice needs its own event"
    assert all("already exists" in (e.message or "") for e in failures), (
        "SAP's own words must reach the wire - a paraphrase loses the cause"
    )

    closing = [e for e in events if isinstance(e, ev.Text)][-1].delta
    assert "refused 5" in closing, closing
    assert "0 parked" in closing, closing


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
        await collect(validate_run(run, [], sap, judge, sample=True))
        for inv in run.invoices:
            inv.source = f"s3://516359819848-invoice/{inv.file}"
        return await collect(post_run(run, sap, mover, None, None)), mover

    # Parks, so it needs its own file - see `settled`.
    with its_own_database():
        events, mover = asyncio.run(run_it())

    assert mover.moves, "the archive copy must still happen"
    assert all(not deleted for _, _, deleted in mover.moves), "nothing outside uploads is deleted"
    assert all(e.status == "kept" for e in events if isinstance(e, ev.Filed))


def test_sample_mode_files_nothing() -> None:
    """No source URI means no object to move, and guessing one deletes the wrong file."""

    async def run_it() -> FakeMover:
        store, sap, judge, mover = RunStore(), FakeSap(), FakeJudge(), FakeMover()
        run = store.create("r_sample", "516359819848", "en")
        # sample batch: source stays ""
        await collect(validate_run(run, [], sap, judge, sample=True))
        await collect(post_run(run, sap, mover, None, None))
        return mover

    # Parks, so it needs its own file - see `settled`.
    with its_own_database():
        assert asyncio.run(run_it()).moves == []


def test_the_write_is_addressed_to_saps_supplier_id_not_the_printed_one() -> None:
    """The invoice prints 17401710; SAP knows the party as BP1710 and rejects the former.

    Rule 4 judging the two equivalent settles validation. It says nothing about
    which id the write has to carry, and using the printed one is why the park
    came back with an OData error instead of a document.
    """

    async def run_it() -> Run:
        store, sap, judge = RunStore(), FakeSap(), FakeJudge()
        run = store.create("r_party", "516359819848", "en")
        await collect(validate_run(run, [], sap, judge))
        return run

    run = asyncio.run(run_it())
    inv = next(i for i in run.invoices if i.invoice_id == "FPL-1563")

    assert inv.vendor == "17401710", "the invoice still records what was printed on it"
    assert inv.sap_supplier == "BP1710", "and what SAP calls the same party"
    assert park_payload(inv, 0, run)["InvoicingParty"] == "BP1710"


def test_the_duplicate_check_asks_about_the_party_sap_knows() -> None:
    """Asking under the printed number searches for a supplier SAP never heard of.

    Rule 16 could only ever come back clean, which is a false pass on the one
    check that stops a batch being parked twice.
    """
    asked: dict[str, str] = {}

    class WatchfulSap(FakeSap):
        async def reference_exists(self, vendor: str, reference: str):
            asked[reference] = vendor
            return await super().reference_exists(vendor, reference)

    async def run_it() -> Run:
        store, judge = RunStore(), FakeJudge()
        run = store.create("r_dup", "516359819848", "en")
        await collect(validate_run(run, [], WatchfulSap(), judge))
        return run

    run = asyncio.run(run_it())

    for inv in run.invoices:
        if inv.sap_supplier:
            assert asked[inv.reference] == inv.sap_supplier, (
                f"{inv.invoice_id} was looked up as {asked[inv.reference]}, "
                f"not SAP's {inv.sap_supplier}"
            )
        else:
            # FPL-9999's purchase order does not exist, so there is no SAP id to
            # learn. The printed number is all we have - and rule 1 has already
            # blocked the invoice, so the lookup cannot change the outcome.
            assert asked[inv.reference] == inv.vendor

    parties = {inv.invoice_id: asked[inv.reference] for inv in run.invoices}
    assert parties["FPL-1563"] == "BP1710", parties


def test_sap_rejection_reaches_the_user_in_saps_own_words() -> None:
    """A rejected write is a 200 carrying an OData error body, not a transport failure.

    Read as a document it just has no `d`, which is how a real complaint became
    "SAP did not return a document number" and cost a whole re-run to learn
    nothing.
    """
    body = {
        "error": {
            "code": "/IWBEP/CM_MGW_RT/020",
            "message": {"lang": "en", "value": "An exception was raised."},
            "innererror": {
                "errordetails": [
                    {"message": "An exception was raised."},
                    {"message": "Tax code V0 does not exist in company code 1010"},
                ]
            },
        }
    }
    framed = f"data: {json.dumps({'result': {'content': [{'text': json.dumps(body)}]}})}"

    try:
        McpSap._unwrap(framed)
    except SapError as error:
        message = str(error)
    else:
        raise AssertionError("an OData error body must raise")

    assert "Tax code V0 does not exist" in message, message
    assert message.count("An exception was raised.") == 1, f"headline repeated: {message}"


def test_a_successful_write_is_still_returned_untouched() -> None:
    body = {"d": {"SupplierInvoice": "5100001500", "FiscalYear": "2025"}}
    framed = f"data: {json.dumps({'result': {'content': [{'text': json.dumps(body)}]}})}"
    assert McpSap._unwrap(framed) == body
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

    # Parking moves an invoice out of "ready" entirely. Answering "ready" for a
    # document that already exists in SAP invites approving it a second time.
    asyncio.run(collect(post_run(run, sap, FakeMover())))
    after = dispatch("invoice_detail", {"invoice": "FPL-1563"})
    assert after["verdict"] == "parked", after["verdict"]
    assert after["sap_document"], "and it must carry the document number"
    assert dispatch("batch_totals", {})["ready"] == 0, "nothing is still awaiting approval"
    assert dispatch("batch_totals", {})["parked"] == 5


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


def test_an_invoice_parked_last_week_cannot_be_parked_again() -> None:
    """The duplicate that costs real money, and the one nothing else catches.

    Rule 16's SAP lookup asks whether OUR reference exists, and that is minted
    fresh every run so rehearsals do not collide - so it can only ever catch the
    sequence colliding with itself. The same supplier invoice arriving next week,
    under a new file name, sailed through all sixteen checks and paid twice.
    """
    with its_own_database():
        sap, judge = FakeSap(), FakeJudge()
        store = RunStore()

        # Not sample=True: the demo batch is fixture data and is deliberately
        # exempt, so a rehearsal cannot block the live demo an hour later. These
        # stand in for documents somebody uploaded.
        first = store.create("r_week1", "516359819848", "en")
        asyncio.run(collect(validate_run(first, [], sap, judge)))
        asyncio.run(collect(post_run(first, sap, FakeMover())))
        assert first.sap_documents, "the first run must actually park something"

        # Same invoices, a new run, fresh references - which is exactly what used
        # to make this sail through all sixteen checks.
        second = store.create("r_week2", "516359819848", "en")
        events = asyncio.run(collect(validate_run(second, [], sap, judge)))

        approval = next(e for e in events if isinstance(e, ev.Approval))
        parked = list(first.sap_documents)
        assert all(i in approval.blockedIds for i in parked), approval.blockedIds
        assert not any(i in approval.readyIds for i in parked), "nothing parked may park again"

        repeat = next(
            e for e in events if isinstance(e, ev.Rule) and e.ruleId == 16 and e.status == "fail"
        )
        document = first.sap_documents[repeat.invoiceId]
        assert document in (repeat.detail or ""), "the reason must name the document it repeats"


def test_a_database_from_before_a_column_existed_still_opens() -> None:
    """Schema changes must not require anyone to delete their data.

    CREATE TABLE IF NOT EXISTS leaves an existing table exactly as it was, so a
    file created before a column was added kept the old shape and every query
    naming that column failed with "no such column" - on a machine whose only
    mistake was having run the project before.
    """
    import sqlite3

    from app import db

    previous = os.environ["AP_DB_PATH"]
    old = Path(tempfile.gettempdir()) / "strike-ap-old-shape.db"
    old.unlink(missing_ok=True)

    # The runs table as it was before `sample` was added.
    with sqlite3.connect(old) as raw:
        raw.execute(
            "CREATE TABLE runs (run_id TEXT PRIMARY KEY, account TEXT NOT NULL, "
            "locale TEXT NOT NULL, state TEXT NOT NULL, "
            "created_at TEXT NOT NULL DEFAULT (datetime('now')))"
        )
        raw.execute("INSERT INTO runs (run_id, account, locale, state) VALUES ('r_old','a','en','done')")

    os.environ["AP_DB_PATH"] = str(old)
    try:
        # The query that used to fail outright.
        assert db.parked_before("17401710", "FPL-1563", "r_new") is None
        with closing(db.connect()) as connection:
            columns = {row["name"] for row in connection.execute("PRAGMA table_info(runs)")}
            assert "sample" in columns, columns
            kept = connection.execute("SELECT run_id, sample FROM runs").fetchone()
            assert kept["run_id"] == "r_old", "existing rows survive the migration"
            assert kept["sample"] == 0, "and default to not being demo data"
    finally:
        os.environ["AP_DB_PATH"] = previous


def test_rehearsing_the_demo_cannot_block_the_demo() -> None:
    """The sample batch is fixture data, and must not arm the duplicate check.

    Parking it once at midnight would otherwise block every invoice in it at two
    the following afternoon - a control that protects nothing, failing at the
    only moment anyone is watching.
    """
    with its_own_database():
        sap, judge = FakeSap(), FakeJudge()
        store = RunStore()

        rehearsal = store.create("r_rehearsal", "516359819848", "en")
        asyncio.run(collect(validate_run(rehearsal, [], sap, judge, sample=True)))
        asyncio.run(collect(post_run(rehearsal, sap, FakeMover())))
        assert rehearsal.sap_documents, "the rehearsal must really have parked"

        # Fresh SAP, as a new day would be: only our own database remembers.
        demo = store.create("r_demo", "516359819848", "en")
        events = asyncio.run(collect(validate_run(demo, [], FakeSap(), judge, sample=True)))

        approval = next(e for e in events if isinstance(e, ev.Approval))
        assert len(approval.readyIds) == 5, approval.readyIds
        assert approval.blockedIds == ["FPL-9999"], approval.blockedIds


def test_the_reference_tool_says_nothing_rather_than_guessing() -> None:
    """No knowledge base configured must not become an answer from memory.

    A teammate without the env var should get an agent that says it cannot look
    the field up - not one that invents SAP semantics confidently.
    """
    from app.ask import dispatch

    configured = os.environ.pop("SAP_API_KNOWLEDGE_BASE_ID", None)
    try:
        empty = dispatch("sap_reference", {"query": "GR-based invoice verification"})
        assert empty["count"] == 0 and empty["passages"] == []
    finally:
        if configured is not None:
            os.environ["SAP_API_KNOWLEDGE_BASE_ID"] = configured


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
