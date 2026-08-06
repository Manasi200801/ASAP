# apps/agent

The orchestrator behind `apps/web`. Implements `contract/events.md`.

## Run it

```bash
cd apps/agent
python -m venv .venv && .venv/Scripts/activate     # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Then point the frontend at it:

```bash
# apps/web/.env.local
AGENT_ENDPOINT=http://localhost:8000
```

It runs with no AWS credentials. `FakeSap` and `FakeJudge` answer from the Lab 06
demo data, so the full batch flow works today — five invoices park, `FPL-9999`
blocks on the missing purchase order.

```bash
python tests/test_run.py     # 6 checks, no framework needed
```

## Shape

```
app/
  main.py           FastAPI: POST /chat, POST /approve, both SSE
  orchestrator.py   the state machine, event pacing, the park payload
  rules.py          the 13 deterministic checks
  judge.py          the 3 that need judgment, plus explanations
  sap.py            SAP access behind one Protocol      ← the integration seam
  extract.py        invoice reading                     ← the other seam
  events.py         Pydantic mirror of the contract
  types.py          shared value objects
```

`uploaded → extracting → validating → awaiting-approval → posting → done`

No model output causes a transition. `/approve` is a separate request and the
state machine rejects it unless the run is awaiting approval, which is what makes
the single human approval gate structural rather than a prompt instruction.

## Wiring the real backends

Three environment variables, three independent swaps. Each one can land on its
own without touching the others or the frontend.

| Variable | Default | Real value | What it needs |
|---|---|---|---|
| `SAP_BACKEND` | `fake` | `mcp` | Lab 05 deployed, `MCP_ENDPOINT` set |
| `EXTRACT_BACKEND` | `sample` | `bedrock` | `INVOICE_BUCKET`, Bedrock access |
| `JUDGE_BACKEND` | `fake` | `bedrock` | Bedrock access, optionally `SOP_KNOWLEDGE_BASE_ID` |

Every `NotImplementedError` in `sap.py`, `extract.py` and `judge.py` names the
exact call it needs. The shapes they must return are already pinned by the fake
implementations and covered by the tests, so nothing downstream changes.

**Start with `SAP_BACKEND=mcp`.** It is the only one that is externally blocked,
and the only one a jury can see the difference on.

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
