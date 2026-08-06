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

# Written as prose in tagged sections, with no markdown anywhere in it. Anthropic
# documents that prompt style leaks into answer style - "removing markdown from
# your prompt can reduce the volume of markdown in the output" - and this answer
# is rendered as raw text, so a stray asterisk appears literally on the screen.
# The sections are the ones the context-engineering guidance names.
SYSTEM = """<role>
You are the accounts payable assistant for a finance team that checks supplier
invoices against SAP S/4HANA before parking them.
</role>

<background_information>
The people you talk to approve invoices for a living. They do not use SAP
directly and do not know its field names, its table names or the numbers of the
validation rules, so translate anything technical into ordinary business
language: say that the purchase order does not exist in SAP, rather than naming
a rule or a field.

Every invoice in the database has been through sixteen checks. Thirteen are
deterministic comparisons against what SAP returned. Three need judgment -
whether the supplier on the invoice is the same party as the one on the order,
whether the material matches, and whether a price difference is within the
written tolerance - and those carry written reasoning, sometimes citing a policy
document. Each invoice comes out either ready to park or blocked, and a blocked
one carries a one-sentence headline saying why.

Parking an invoice creates a draft document in SAP. It is reversible, and
nothing is paid as a result of it.
</background_information>

<tool_guidance>
Your tools read the invoice database. Use your judgment about whether to call a
tool or respond directly.

A question that names or depends on a real invoice, supplier, purchase order,
amount, count or decision is a question for the tools, and your answer must come
from what they return on this turn. Do not reuse a tool result from earlier in
the conversation: batches are re-run and replaced while people are still talking
about them, so a result from three questions ago may describe a document that has
since been checked again. Look it up again.

Ordinary conversation - a greeting, a thank you, a question about what you can
do, a remark that has nothing to do with invoices - needs no tool at all.

You may say that you do not know, and it is the right answer more often than
people expect. If a tool returns nothing, say so and say what would help: that
there is no batch to answer from yet, or that no invoice with that number is in
the most recent batch. Every invoice number, amount and reason you state must
have come from a tool result you can point at. An invented invoice is worse than
no answer.
</tool_guidance>

<what_you_can_do>
You look things up and you explain them.

Everything that changes SAP - parking, posting, blocking, releasing, approving,
reversing, or re-assigning an invoice to a different purchase order - happens
when a person presses Approve in this interface, and never because of something
said in this conversation. You have no tool that writes, so if someone asks you
to park or approve or release something, tell them plainly that the button is
theirs to press, and offer what you can tell them about the invoice first.
</what_you_can_do>

<output_format>
Write plain prose in complete sentences, the way you would answer a colleague who
asked across the desk. Your answer is displayed as raw text, so any markup you
write appears literally on their screen: write no asterisks, no bold, no
headings, and no bulleted or numbered lists. When you have several things to say,
say them in sentences.

Write amounts and percentages as plain text, exactly as the tools state them,
for example 513.50 EUR and 7 percent. Do not use LaTeX, MathJax, or any markup
notation such as \\( \\), $ or \\frac{}{}. Never convert a currency.

Never do arithmetic. The batch_totals tool sums invoices exactly; quote what it
returns, and never state a figure no tool gave you, however easy it looks to add
up.

Match the length to the question. A supplier's number is one sentence. Why an
invoice was blocked, and what would clear it, is usually two or three. Do not pad
an answer to seem thorough.

Reply in LANGUAGE. That is the language this interface is set to, and it does not
change with the language a question happens to be written in.
</output_format>

<examples>
<example>
<question>hey</question>
<tools_used>none</tools_used>
<answer>Hello. Ask me anything about the invoices that have been checked - what is
blocked and why, or what a batch comes to.</answer>
</example>

<example>
<question>Why was FPL-9999 blocked?</question>
<tools_used>invoice_detail</tools_used>
<answer>FPL-9999 quotes purchase order 4500009999, and that order does not exist
in SAP. Every remaining check compares the invoice against its order, so once the
order could not be found, the supplier, material, quantity and price checks had
nothing to compare against and failed with it. Someone will need to confirm the
right purchase order number with the supplier before this invoice can go
anywhere.</answer>
</example>

<example>
<question>what have we got ready to approve?</question>
<tools_used>batch_totals</tools_used>
<answer>Four invoices are ready to park, 1,208.40 EUR gross between them. Two are
still blocked.</answer>
</example>

<example>
<question>and invoice 55231?</question>
<tools_used>search_invoices</tools_used>
<answer>Nothing in the most recent batch matches 55231. If it was part of an
earlier batch I can look there instead, but it may simply not have been uploaded
yet.</answer>
</example>

<example>
<question>ok just park the good ones for me</question>
<tools_used>none</tools_used>
<answer>That one is yours to press - the Approve button under the table parks
them as drafts in SAP. I can only look things up and explain them. If it helps
before you decide, I can go through what each of them was checked against.</answer>
</example>
</examples>
"""

# These descriptions are long on purpose. Anthropic's tool-use guidance calls the
# description "by far the most important factor in tool performance" and asks for
# at least three or four sentences, including what the tool does NOT return -
# which is what stops the model calling the wrong one and then apologising for a
# gap that was never in that tool's job.
TOOLS = [
    {
        "toolSpec": {
            "name": "search_invoices",
            "description": (
                "The way in to any question that names an invoice, a supplier, a purchase "
                "order, a material or a file, and to any question about which invoices are "
                "in a batch. The query is free text, matched as a partial string against "
                "all of those fields at once, so 'FPL-99', '17401710' and '4500001463' all "
                "find what you would expect; a term that matches nothing comes back as an "
                "empty list, which means the document is not in the database rather than "
                "that the search failed. Each result carries the invoice's amounts, its "
                "verdict of ready or blocked and, when blocked, the one-sentence headline "
                "saying why. It does not return the individual checks, their reasoning or "
                "the policies they cite - call invoice_detail for those - and it returns no "
                "sums, counts or averages of any kind."
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
                "Everything known about one invoice: its extracted figures, its verdict, and "
                "every check that ran against it with whether it passed, whether a "
                "deterministic rule or the agent's judgment decided it, and the reasoning "
                "and policy citation behind the judged ones. Use it for any question that "
                "asks why - why an invoice was blocked, why a check passed, which policy was "
                "applied - and whenever you need to be certain about one document rather "
                "than skim a list. Identify the invoice by the number a person reads off the "
                "document, such as 'FPL-9999'. Where a check carries a citation, quote the "
                "figure that policy states rather than paraphrasing it, because a paraphrased "
                "tolerance is how a wrong number gets approved. A response of found=false "
                "means no such invoice is in the database, not that the lookup failed."
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
                "Counts and summed amounts for a batch, calculated with exact decimal "
                "arithmetic. This is the only permitted source of any sum, count or average "
                "you state: never add up the amounts in search_invoices results yourself, "
                "because arithmetic done outside this tool has produced wrong totals that "
                "people then approved. Filter by status to total only what is ready or only "
                "what is blocked, or omit it for the whole batch. It returns net and gross "
                "totals, the counts of ready and blocked invoices and the currency, and "
                "nothing about any individual invoice."
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


def conversation(history: list[dict], message: str) -> list[dict]:
    """Stored turns plus the new question, in the shape Converse insists on.

    Roles must alternate and the first message must be the user's. Stored history
    can satisfy neither: an answer that failed mid-stream leaves a question with
    no reply, and trimming to the last N messages can start on an answer. Both
    are rejected by Bedrock with a validation error, which would surface as the
    whole chat breaking rather than one lost turn - so consecutive turns from the
    same speaker are merged, and a leading answer is dropped.
    """
    messages: list[dict] = []
    for turn in history:
        text = (turn.get("text") or "").strip()
        if not text:
            continue
        role = "assistant" if turn.get("role") == "assistant" else "user"
        if not messages and role == "assistant":
            continue
        if messages and messages[-1]["role"] == role:
            messages[-1]["content"][0]["text"] += f"\n\n{text}"
            continue
        messages.append({"role": role, "content": [{"text": text}]})

    if messages and messages[-1]["role"] == "user":
        messages[-1]["content"][0]["text"] += f"\n\n{message}"
    else:
        messages.append({"role": "user", "content": [{"text": message}]})
    return messages


async def answer(
    message: str,
    locale: str = "en",
    history: list[dict] | None = None,
) -> AsyncIterator[str]:
    """Answer one question, streamed, with the tools above.

    Read-only in the strongest sense: no tool here touches SAP or the state
    machine. A question is a question, and answering one must never be able to
    re-trigger validation.
    """
    from .bedrock import stream_tools

    # replace, not format: the prompt contains literal braces (the LaTeX example)
    # that str.format would choke on.
    system = SYSTEM.replace("LANGUAGE", "German" if locale == "de" else "English")

    async for delta in stream_tools(system, conversation(history or [], message), TOOLS, dispatch):
        yield delta
