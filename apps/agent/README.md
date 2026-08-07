# apps/agent

The orchestrator behind `apps/web`. Implements `contract/events.md`.

## Run it

First-time setup, including the virtualenv on both platforms, is in the root
`README.md`. From the repo root, `npm run dev` starts this and the frontend
together with prefixed logs. To run only this half:

```bash
cd apps/agent

# macOS / Linux
.venv/bin/python -m uvicorn app.main:app --reload --reload-dir app --port 8000

# Windows
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --reload-dir app --port 8000
```

Run it through the venv interpreter, not a bare `uvicorn`. A bare `uvicorn`
resolves off `PATH`, and on a machine with Anaconda installed that is usually
Anaconda's — a different interpreter, with different packages and a different
SSL configuration. The usual symptom is not an import error but this:

```
SSL validation failed for https://bedrock-runtime.us-east-1.amazonaws.com/...
[Errno 2] No such file or directory
```

which reads like a network problem and is actually the wrong Python.

`--reload-dir app` keeps the watcher off `.venv` and `build/`. Without it uvicorn
watches the whole directory — tens of thousands of files, slow to start, and it
restarts the agent when nothing you wrote changed.

It runs with no AWS credentials. `FakeSap` and `FakeJudge` answer from the Lab 06
demo data, so the full batch flow works today — five invoices park, `FPL-9999`
blocks on the missing purchase order.

`GET /health` reports which backends are live, and is the fastest way to catch
the mistake of demoing against the fakes by accident:

```json
{ "status": "ok", "sap": "McpSap", "judge": "BedrockJudge" }
```

```bash
python tests/test_run.py     # 6 checks, no framework needed
```

Set `LOG_LEVEL=DEBUG` for more detail. At the default `INFO` every SAP call
reports its entity and latency, every model call its token counts, and every
invoice its verdict and the rule that blocked it.

## Shape

```
app/
  main.py           FastAPI: POST /chat, POST /approve, both SSE
  orchestrator.py   the state machine, event pacing, the park payload
  rules.py          the 13 deterministic checks
  judge.py          the 3 that need judgment, plus explanations
  ask.py            the chat brain: three tools over the database
  db.py             SQLite: every invoice read, every check run
  sap.py            SAP access behind one Protocol      ← the integration seam
  extract.py        invoice reading                     ← the other seam
  storage.py        filing settled PDFs between buckets ← and the third
  events.py         Pydantic mirror of the contract
  types.py          shared value objects
```

`uploaded → extracting → validating → awaiting-approval → posting → done`

No model output causes a transition. `/approve` is a separate request and the
state machine rejects it unless the run is awaiting approval, which is what makes
the single human approval gate structural rather than a prompt instruction.

## Wiring the real backends

Four environment variables, four independent swaps. Each one can land on its
own without touching the others or the frontend.

| Variable | Default | Real value | What it needs |
|---|---|---|---|
| `SAP_BACKEND` | `fake` | `mcp` | `AGENT_RUNTIME_ARN` — the AgentCore runtime hosting the SAP MCP server |
| `EXTRACT_BACKEND` | `sample` | `bedrock` | Bedrock access, and PDFs in `UPLOAD_BUCKET` or `INVOICE_BUCKET` |
| `JUDGE_BACKEND` | `fake` | `bedrock` | Bedrock access, optionally `SOP_KNOWLEDGE_BASE_ID` |
| `STORAGE_BACKEND` | `fake` | `s3` | `UPLOAD_BUCKET`, `PROCESSED_BUCKET`, `BLOCKED_BUCKET` |

All four are live. `apps/agent/.env.example` carries the real values and says
where each came from; copy it to `.env.local` and set `AWS_PROFILE=workshop`.

## Where an invoice lives

An invoice moves buckets as it settles, so what is left in the upload bucket is
exactly what still needs attention.

```
              ┌─ parked in SAP ────────────► 516359819848-processed-invoice
              │
uploaded ─────┼─ rejected by a person ─────► 516359819848-blocked-invoice
              │
              └─ nobody decided ───────────► stays put
```

A check failing is a recommendation, not a verdict: the clerk can approve a
blocked invoice anyway, and it is then parked exactly like a clean one, with
SAP's answer reported verbatim. An override SAP refuses stays in the upload
bucket — nobody rejected it, and a retry may well work once the underlying
problem is fixed.

`516359819848-invoice` holds the six workshop PDFs that `Load batch` reads. It is
copied from and **never** deleted from; the mover enforces that by bucket rather
than by intent, because emptying it would destroy the demo fallback for the whole
account on the first successful run.

The Cognito client id and secret are deliberately not in any file — `McpSap`
reads them from Secrets Manager at runtime.

## Knowledge bases

Two, and they do different jobs.

`SOP_KNOWLEDGE_BASE_ID` grounds rule 9 during validation. Without it the price
check falls back to a flat 5% and says so; with it, rule 9 reads the tiered
policy in `docs/sops/` and cites the document it consulted.

`SAP_API_KNOWLEDGE_BASE_ID` backs the chat's `sap_reference` tool. It holds the
OpenAPI specs for the four OData services this system calls, so a question about
what a SAP field means is answered from SAP's own documentation. When it has
nothing on the subject the agent says so rather than filling the gap from memory
— which it does, verifiably: asked what supplier invoice status `A` means, it
reports that the spec names the field but not the code values.

```bash
python scripts/make_kb.py sops       # rebuilds either one end to end,
python scripts/make_kb.py sap-api    # about 90 seconds each
```

## Two ways into `/chat`

Same endpoint, two behaviours, and the distinction matters:

- **no message** — starts a run: extract, validate, stop at `awaiting-approval`
- **a message** — always a question, never a run. Answering touches neither SAP
  nor the state machine, so asking about an invoice can never re-check the batch.

## How the chat answers

Nothing about the batch is written into the prompt. The model gets a job
description and four tools, and fetches what it needs:

| Tool | Answers | Reads |
|---|---|---|
| `search_invoices` | "which ones are blocked?", "anything from 17401710?" | `db.py` |
| `invoice_detail` | "why was FPL-9999 blocked?" — every check, with reasoning and citation | `db.py` |
| `batch_totals` | "what's ready to approve?" — summed in Python, never by the model | `db.py` |
| `sap_reference` | "what does GR-based invoice verification mean?" | SAP API knowledge base |

The split matters: the first three answer what happened to a document, the fourth
answers what SAP means by something. Without the fourth, a question about a field
is answered from whatever the model remembers about SAP — which is exactly where
a confident wrong answer costs the most.

That is what makes it an assistant rather than a template. A greeting needs no
rule in the prompt: there is nothing to look up, so nothing is looked up. A
question about a batch from an hour ago works the same as one about the batch on
screen, because both are rows in the same table.

Totals are `Decimal` arithmetic in `db.totals`. A model asked to add up invoices
will do it and get it wrong — an early version answered 454.00 for a batch of
513.50.

## The database

SQLite, standard library, one file at `apps/agent/data/ap.db` (`AP_DB_PATH` moves
it). Every run writes its invoices and every check that ran against them, once
when validation settles and again after posting.

It exists because the store used to be in memory: a question after a restart was
answered with "I no longer have that batch", which is a demo ending itself. It is
also the swap point — DynamoDB later means reimplementing `save_run`,
`search_invoices`, `invoice_detail` and `totals`, and nothing else.

```bash
sqlite3 data/ap.db "select supplier_invoice_id, verdict, headline from invoices"
```

## Three traps

These are in `contract/events.md` too, repeated because each one can end a demo.

**Posting period.** `DocumentDate` and `PostingDate` must be `2025-03-15`. The
workshop books run in early 2025 and today's date fails with a posting-period
error. Rule 15 checks it before anything reaches SAP.

**Re-run duplicates.** `SupplierInvoiceIDByInvcgParty` must be unique per
supplier. `RunStore` advances the sequence base by 50 per run so a rehearsal
never collides with itself. The field caps at 16 characters.

**Business Partner mapping.** Invoices carry supplier `17401710`; the purchase
order reports `BP1710`. Naive string equality on rule 4 fails all five valid
invoices, which is why that rule is agent-decided. `FakeSap` reproduces the
mismatch on purpose — a fake that quietly agreed would hide the one case worth
testing.
