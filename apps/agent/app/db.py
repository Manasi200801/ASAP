"""What the agent knows, on disk.

Every invoice this system has ever read, with every check that was run against
it. The chat layer queries this rather than being handed a pre-rendered summary
in its prompt - which is the difference between an assistant that can answer a
question and one that can only recite the paragraph someone wrote for it.

SQLite because it is in the standard library: no service to deploy, no
credentials, no cost, and it survives a restart - which is what the in-memory
store did not, so a question after a reload used to be answered with "I no longer
have that batch".

Swapping this for DynamoDB later means reimplementing four functions
(`save_run`, `search_invoices`, `invoice_detail`, `totals`) and nothing else. The
callers never see SQL.
"""

from __future__ import annotations

import logging
import os
import sqlite3
from contextlib import closing
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

log = logging.getLogger("app.db")

DEFAULT_PATH = Path(__file__).resolve().parent.parent / "data" / "ap.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS runs (
    run_id     TEXT PRIMARY KEY,
    account    TEXT NOT NULL,
    locale     TEXT NOT NULL,
    state      TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS invoices (
    invoice_id          TEXT NOT NULL,
    run_id              TEXT NOT NULL,
    file                TEXT NOT NULL,
    supplier_invoice_id TEXT,
    vendor              TEXT,
    purchase_order      TEXT,
    purchase_order_item TEXT,
    material            TEXT,
    quantity            TEXT,
    unit                TEXT,
    unit_price          TEXT,
    net_amount          TEXT,
    gross_amount        TEXT,
    currency            TEXT,
    verdict             TEXT,
    headline            TEXT,
    duplicate_of        TEXT,
    reference           TEXT,
    sap_document        TEXT,
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (run_id, invoice_id)
);

CREATE TABLE IF NOT EXISTS checks (
    run_id     TEXT NOT NULL,
    invoice_id TEXT NOT NULL,
    rule_id    INTEGER NOT NULL,
    label      TEXT NOT NULL,
    passed     INTEGER NOT NULL,
    decided_by TEXT NOT NULL,
    detail     TEXT,
    reasoning  TEXT,
    citation   TEXT,
    PRIMARY KEY (run_id, invoice_id, rule_id)
);

CREATE INDEX IF NOT EXISTS invoices_supplier_invoice
    ON invoices (supplier_invoice_id);
"""


def path() -> Path:
    return Path(os.getenv("AP_DB_PATH") or DEFAULT_PATH)


def connect() -> sqlite3.Connection:
    """A fresh connection per call.

    ponytail: connection-per-call, because every query here reads a handful of
    rows off local disk in well under a millisecond and a pool would be pure
    ceremony. If this ever fronts something concurrent, hold one connection per
    thread instead.
    """
    file = path()
    file.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(file)
    connection.row_factory = sqlite3.Row
    # Readers never block on the writer, so a question asked mid-run answers
    # instead of waiting for the batch to finish writing.
    connection.execute("PRAGMA journal_mode=WAL")
    # Every statement is IF NOT EXISTS and this costs microseconds, which buys
    # the guarantee that no caller can ever query a database nobody initialised.
    connection.executescript(SCHEMA)
    return connection


def init() -> None:
    """Create the file and its schema up front, so startup fails loudly if it cannot."""
    with closing(connect()):
        pass


def save_run(run: Any) -> None:
    """Write a run and everything decided about it. Safe to call repeatedly.

    Called once when validation settles and again after posting, so the parked
    SAP document numbers land too.
    """
    from .rules import AGENT_RULE_IDS

    with closing(connect()) as connection, connection:
        connection.execute(
            "INSERT INTO runs (run_id, account, locale, state) VALUES (?, ?, ?, ?) "
            "ON CONFLICT(run_id) DO UPDATE SET state = excluded.state",
            (run.run_id, run.account, run.locale, run.state),
        )

        for inv in run.invoices:
            verdict = "blocked" if inv.invoice_id in run.blocked else "ready"
            connection.execute(
                """
                INSERT INTO invoices (
                    invoice_id, run_id, file, supplier_invoice_id, vendor,
                    purchase_order, purchase_order_item, material, quantity, unit,
                    unit_price, net_amount, gross_amount, currency, verdict,
                    headline, duplicate_of, reference, sap_document
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(run_id, invoice_id) DO UPDATE SET
                    verdict = excluded.verdict,
                    headline = excluded.headline,
                    reference = excluded.reference,
                    sap_document = excluded.sap_document
                """,
                (
                    inv.invoice_id,
                    run.run_id,
                    inv.file,
                    inv.supplier_invoice_id,
                    inv.vendor,
                    inv.purchase_order,
                    inv.purchase_order_item,
                    inv.material,
                    inv.quantity,
                    inv.unit,
                    inv.unit_price,
                    inv.net_amount,
                    inv.gross_amount,
                    inv.currency,
                    verdict,
                    run.headlines.get(inv.invoice_id),
                    inv.duplicate_of,
                    inv.reference,
                    run.sap_documents.get(inv.invoice_id),
                ),
            )

            for result in run.results.get(inv.invoice_id, []):
                connection.execute(
                    """
                    INSERT INTO checks (
                        run_id, invoice_id, rule_id, label, passed, decided_by,
                        detail, reasoning, citation
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(run_id, invoice_id, rule_id) DO UPDATE SET
                        passed = excluded.passed,
                        detail = excluded.detail,
                        reasoning = excluded.reasoning,
                        citation = excluded.citation
                    """,
                    (
                        run.run_id,
                        inv.invoice_id,
                        result.rule_id,
                        result.label,
                        int(result.passed),
                        "agent" if result.rule_id in AGENT_RULE_IDS else "rule",
                        result.detail,
                        result.reasoning,
                        result.citation,
                    ),
                )

    log.info("%s saved: %d invoices", run.run_id, len(run.invoices))


def latest_run_id() -> str | None:
    with closing(connect()) as connection:
        row = connection.execute(
            "SELECT run_id FROM runs ORDER BY created_at DESC, rowid DESC LIMIT 1"
        ).fetchone()
    return row["run_id"] if row else None


def _resolve(run: str | None) -> str | None:
    """`latest` and `None` both mean the batch on screen."""
    if run in (None, "", "latest", "current"):
        return latest_run_id()
    return run


def search_invoices(
    query: str | None = None,
    status: str | None = None,
    run: str | None = None,
    limit: int = 25,
) -> list[dict]:
    """Invoices matching a free-text term, newest run first.

    The term is matched against every field someone would name an invoice by -
    its number, the supplier, the purchase order, the material, the file. One
    LIKE across the lot beats making the model guess which column it wants.
    """
    where = ["1 = 1"]
    values: list[Any] = []

    run_id = _resolve(run)
    if run_id:
        where.append("run_id = ?")
        values.append(run_id)

    if status in ("ready", "blocked"):
        where.append("verdict = ?")
        values.append(status)

    if query:
        where.append(
            "(supplier_invoice_id LIKE ? OR invoice_id LIKE ? OR vendor LIKE ? "
            "OR purchase_order LIKE ? OR material LIKE ? OR file LIKE ?)"
        )
        values.extend([f"%{query}%"] * 6)

    sql = (
        "SELECT invoice_id, supplier_invoice_id, vendor, purchase_order, material, "
        "quantity, unit, unit_price, net_amount, gross_amount, currency, verdict, "
        "headline, duplicate_of, sap_document, file, run_id "
        f"FROM invoices WHERE {' AND '.join(where)} "
        "ORDER BY created_at DESC, rowid ASC LIMIT ?"
    )
    values.append(max(1, min(limit, 50)))

    with closing(connect()) as connection:
        rows = connection.execute(sql, values).fetchall()
    return [dict(row) for row in rows]


def invoice_detail(invoice: str, run: str | None = None) -> dict | None:
    """One invoice with every check that was run against it.

    Matches on the supplier's invoice number or our internal id, because a person
    asks about "FPL-9999" and has never seen an `inv_3`.
    """
    where = "(supplier_invoice_id = ? OR invoice_id = ?)"
    values: list[Any] = [invoice, invoice]

    run_id = _resolve(run)
    if run_id:
        where += " AND run_id = ?"
        values.append(run_id)

    with closing(connect()) as connection:
        row = connection.execute(
            f"SELECT * FROM invoices WHERE {where} ORDER BY created_at DESC LIMIT 1",
            values,
        ).fetchone()
        if row is None:
            return None

        checks = connection.execute(
            "SELECT rule_id, label, passed, decided_by, detail, reasoning, citation "
            "FROM checks WHERE run_id = ? AND invoice_id = ? ORDER BY rule_id",
            (row["run_id"], row["invoice_id"]),
        ).fetchall()

    detail = dict(row)
    detail["checks"] = [
        {**dict(check), "passed": bool(check["passed"])} for check in checks
    ]
    return detail


def totals(run: str | None = None, status: str | None = None) -> dict:
    """Sums, added up here rather than left to the model.

    Asked for a batch total a model will happily do the arithmetic itself and get
    it wrong - an early version answered 454.00 for invoices totalling 513.50.
    Money is not a judgement call.
    """
    rows = search_invoices(status=status, run=run, limit=50)

    net = Decimal(0)
    gross = Decimal(0)
    calculable = True
    for row in rows:
        try:
            net += Decimal(row["net_amount"] or "0")
            gross += Decimal(row["gross_amount"] or "0")
        except InvalidOperation:  # an unparsable amount must not fake a total
            calculable = False
            break

    currencies = {row["currency"] for row in rows if row["currency"]}
    return {
        "invoices": len(rows),
        "ready": sum(1 for row in rows if row["verdict"] == "ready"),
        "blocked": sum(1 for row in rows if row["verdict"] == "blocked"),
        "net_total": f"{net:.2f}" if calculable else "not calculable",
        "gross_total": f"{gross:.2f}" if calculable else "not calculable",
        "currency": currencies.pop() if len(currencies) == 1 else "mixed",
    }
