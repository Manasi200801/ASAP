# apps/agent

The orchestrator behind `apps/web`. Implements `contract/events.md`.

## Run it

First-time setup, including the virtualenv on both platforms, is in the root
`README.md`. From the repo root, `npm run dev` starts this and the frontend
together with prefixed logs. To run only this half:

```bash
cd apps/agent
uvicorn app.main:app --reload --port 8000
```

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

`SOP_KNOWLEDGE_BASE_ID` grounds rule 9. Without it the price check falls back to
a flat 5% and says so; with it, rule 9 reads the tiered policy in `docs/sops/`
and cites the document it consulted.

```bash
python scripts/make_kb.py sops       # rebuilds it end to end, about 90 seconds
```

## Two ways into `/chat`

Same endpoint, two behaviours, and the distinction matters:

- **no message, or no run yet** — starts a run: extract, validate, stop at
  `awaiting-approval`
- **a message about a run that already exists** — answers the question from the
  stored result, streaming the reply token by token

Answering touches neither SAP nor the state machine. Totals in answers are
computed in Python and handed to the model as facts, because a model asked to add
up invoices will do it and get it wrong.

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
