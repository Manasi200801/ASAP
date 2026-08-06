"""The chat brain.

The prompt carries no invoices. It carries a job description and three tools, and
the model fetches what it needs from `db.py`. That is deliberate: the previous
version rendered the whole run into the prompt as a paragraph and instructed the
model to answer from it, which made every new kind of question a prompt edit -
including, absurdly, a rule about how to respond to "hello".

With tools, a greeting needs no rule. There is nothing to look up, so the model
looks nothing up and just answers.
"""

from __future__ import annotations

import logging
from typing import AsyncIterator

from . import db

log = logging.getLogger("app.ask")

SYSTEM = """You are the accounts payable assistant for a finance team that parks
supplier invoices in SAP S/4HANA.

Your tools read the invoice database: every document that has been checked, every
check that ran against it, and what each one decided. Use them whenever the
question touches a real invoice, supplier, purchase order, amount or decision -
never answer that kind of question from memory or from earlier in the
conversation alone.

Ordinary conversation - a greeting, a thank you, a question about what you can
do - needs no tool. Answer it the way a colleague would: briefly, and without
reciting the batch at someone who only said hello.

How to write:
- Plain business language. The reader approves invoices; they do not know SAP
  field names or rule numbers, so translate rather than quote.
- Plain text only. No markdown, no asterisks, no headings, no bullet lists - the
  answer is rendered exactly as you write it.
- Two or three sentences unless the question genuinely needs more.
- Never do arithmetic yourself. `batch_totals` sums invoices for you; quote what
  it returns and never present a figure no tool gave you.
- Amounts are in the currency the tools state. Never convert them.
- If the tools return nothing, say so plainly and say what would help - do not
  invent an invoice.

What you can and cannot do: you explain and look things up. You never post,
park, reverse or change anything. Parking happens when the user presses Approve,
never because of something said in conversation.
"""

TOOLS = [
    {
        "toolSpec": {
            "name": "search_invoices",
            "description": (
                "Find invoices that have been checked. Use a free-text term to match an "
                "invoice number, supplier, purchase order, material or file name. Omit the "
                "term to list the whole batch. Returns each invoice with its verdict and, "
                "when blocked, the headline reason."
            ),
            "inputSchema": {
                "json": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "Free text, e.g. 'FPL-9999', '17401710' or '4500001463'.",
                        },
                        "status": {
                            "type": "string",
                            "enum": ["ready", "blocked"],
                            "description": "Restrict to one verdict.",
                        },
                        "run": {
                            "type": "string",
                            "description": "Batch id. Defaults to the most recent batch.",
                        },
                        "limit": {"type": "integer", "description": "Maximum rows, up to 50."},
                    },
                }
            },
        }
    },
    {
        "toolSpec": {
            "name": "invoice_detail",
            "description": (
                "Everything known about one invoice, including every check that ran, whether "
                "each passed, whether a rule or the agent decided it, and the reasoning and "
                "policy citation behind the judged ones. Use this for any 'why' question."
            ),
            "inputSchema": {
                "json": {
                    "type": "object",
                    "properties": {
                        "invoice": {
                            "type": "string",
                            "description": "The supplier's invoice number, e.g. 'FPL-9999'.",
                        },
                        "run": {
                            "type": "string",
                            "description": "Batch id. Defaults to the most recent batch.",
                        },
                    },
                    "required": ["invoice"],
                }
            },
        }
    },
    {
        "toolSpec": {
            "name": "batch_totals",
            "description": (
                "Counts and summed amounts for a batch, calculated exactly. Always use this "
                "instead of adding invoice amounts yourself."
            ),
            "inputSchema": {
                "json": {
                    "type": "object",
                    "properties": {
                        "status": {"type": "string", "enum": ["ready", "blocked"]},
                        "run": {
                            "type": "string",
                            "description": "Batch id. Defaults to the most recent batch.",
                        },
                    },
                }
            },
        }
    },
]


def dispatch(name: str, arguments: dict) -> dict:
    """Run one tool call. Blocking - it is called on the Converse worker thread.

    Every return is a dict, because a Bedrock tool result must be a JSON object
    and a bare list is rejected.
    """
    if name == "search_invoices":
        rows = db.search_invoices(
            query=arguments.get("query"),
            status=arguments.get("status"),
            run=arguments.get("run"),
            limit=int(arguments.get("limit") or 25),
        )
        return {"invoices": rows, "count": len(rows)}

    if name == "invoice_detail":
        found = db.invoice_detail(str(arguments.get("invoice", "")), arguments.get("run"))
        # Not an error: "no such invoice" is a real and useful answer, and the
        # model should say so rather than retry the same lookup.
        return found or {"found": False, "invoice": arguments.get("invoice")}

    if name == "batch_totals":
        return db.totals(run=arguments.get("run"), status=arguments.get("status"))

    return {"error": f"No tool named {name}."}


async def answer(
    message: str,
    locale: str = "en",
    history: list[tuple[str, str]] | None = None,
) -> AsyncIterator[str]:
    """Answer one question, streamed, with the tools above.

    Read-only in the strongest sense: no tool here touches SAP or the state
    machine. A question is a question, and answering one must never be able to
    re-trigger validation.
    """
    from .bedrock import stream_tools

    language = "German" if locale == "de" else "English"

    messages: list[dict] = []
    for question, previous in history or []:
        messages.append({"role": "user", "content": [{"text": question}]})
        messages.append({"role": "assistant", "content": [{"text": previous}]})
    messages.append({"role": "user", "content": [{"text": message}]})

    async for delta in stream_tools(
        f"{SYSTEM}\nAnswer in {language}.", messages, TOOLS, dispatch
    ):
        yield delta
