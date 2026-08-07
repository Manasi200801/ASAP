# AWS Autonomous SAP Accounts Payable

Build an AI-powered invoice processing agent that allows business users to upload supplier invoices, validate them against live SAP S/4HANA data, and post approved invoices automatically. The solution should support batch processing, robust business-rule validation, clear exception reporting, and a single human approval step before anything is posted.

## Demo

[Link to demo video or live demo - hosted on YouTube/Vimeo, NOT in the repo]

## Screenshots

[Add 2-3 screenshots showing key features]

## Problem Statement

**Challenge:** AWS Autonomous SAP Accounts Payable

Build an AI-powered invoice processing agent that allows business users to upload supplier invoices, validate them against live SAP S/4HANA data, and post approved invoices automatically. The solution should support batch processing, robust business-rule validation, clear exception reporting, and a single human approval step before anything is posted.

## Solution

A batch of supplier invoice PDFs is uploaded straight from the browser to S3 via presigned URLs. A Python orchestrator extracts each invoice with Bedrock, checks it against live SAP S/4HANA data through an MCP server, and streams every step back to the UI as it happens — each invoice, each rule, each SAP call.

Sixteen validation rules run per invoice. Thirteen are deterministic comparisons in code; three need judgment and are decided by a model that states its reasoning and, for price tolerance, cites the AP policy document it consulted. Every rule chip in the UI records whether code or a model decided it, and on what evidence.

Nothing reaches SAP without a human. The run stops at `awaiting-approval` and only a separate `/approve` request writes. Approved invoices are parked as reversible drafts (`SupplierInvoiceStatus: "A"`), never posted for payment.

The full contract between the two halves — every event, every rule, every environment fact — is `contract/events.md`.

## Key Features

- Batch upload of invoice PDFs, presigned straight to S3 so files never pass through the web server
- Bedrock extraction with per-field confidence scores; fields below 0.8 are flagged rather than presented as certain
- 16 validation rules per invoice: 13 deterministic, 3 agent-decided, each one showing its evidence
- Rule 9 (price tolerance) reads the AP standard operating procedures from a Bedrock Knowledge Base and cites the document
- Live SAP call rail — every OData read through the MCP server is streamed to the UI as it happens
- Exception reporting in plain business language: headline, business impact, and where possible a concrete correction proposal
- A single, structural human approval gate: approval is a separate HTTP request, and the state machine rejects it unless the run is awaiting approval
- Full fake/sample backends, so the whole flow runs with no AWS credentials at all

## Tech Stack

| Component | Technology |
| --- | --- |
| Frontend | Next.js 15 (App Router), React 19, Tailwind CSS v4, TypeScript |
| Frontend tooling | Biome (lint/format), Vitest, `tsc --noEmit` |
| Backend | Python 3.11+, FastAPI, Pydantic, uvicorn, boto3 |
| AI/ML | Amazon Bedrock, `us.anthropic.claude-sonnet-4-6` (extraction + the 3 agent-decided rules) |
| Retrieval | Bedrock Knowledge Bases on S3 Vectors, `amazon.titan-embed-text-v2:0` |
| SAP access | AWS SAP MCP Server on Bedrock AgentCore Runtime (behind Cognito) to S/4HANA OData |
| Storage | Amazon S3 (invoice PDFs, presigned PUT) |
| Transport | Server-Sent Events for both run streams |

Sonnet 5 and Opus 5 are listed by `list-inference-profiles` on the workshop account but Converse returns `AccessDenied`; 4.6 is the newest that actually works there.

## Architecture

Two independent apps talking over one documented event contract.

```
browser
  |
  |  1. POST /api/upload -> presigned PUT URLs
  |  2. PUT each PDF directly to S3            s3://516359819848-invoice/runs/<runId>/
  |  3. POST /api/chat, POST /api/approve
  v
apps/web  (Next.js 15 route handlers, SSE passthrough)
  |
  |  AGENT_ENDPOINT
  v
apps/agent  (FastAPI)
  |
  |  state machine, owns every transition:
  |  uploaded -> extracting -> validating -> awaiting-approval -> posting -> done
  |                                                            \-> failed
  |
  +-- extract.py  Bedrock reads the invoice PDFs out of S3
  +-- rules.py    13 deterministic rules (1,2,3,5,6,8,10,11,12,13,14,15,16)
  +-- judge.py    3 agent-decided rules: 4 supplier, 7 material, 9 price tolerance
  |                 rule 9 retrieves from the SOP knowledge base and cites it
  +-- sap.py      MCP server on AgentCore Runtime -> S/4HANA OData
```

No model output can cause a state transition — the Python state machine owns them all. `/approve` is a distinct request rather than a chat message, which is what makes the single approval gate structural rather than a prompt instruction.

`apps/agent/README.md` has the module-by-module breakdown; `contract/events.md` has every event shape, the full rule table, and the three traps (posting period, re-run duplicate references, Business Partner ID mapping).

## Getting Started

### Prerequisites

- **Node.js 22** (CI pins 22; the dev runner needs it)
- **Python 3.11 or newer** (CI runs 3.12)
- **AWS CLI v2** — only needed for the live AWS path, not for the fake backends
- **An AWS profile named `workshop`** — from Workshop Studio, "Get AWS CLI credentials", pasted into `~/.aws/credentials` as a `[workshop]` block. These expire when the event does; re-copy them if calls start failing with `ExpiredToken`.

There is **no root `npm install`** and no npm workspace. The two apps own their own dependencies and are installed separately. The root `package.json` exists only to provide `npm run dev`, and has no dependencies of its own.

### Setup — macOS / Linux

```bash
git clone https://github.com/Manasi200801/seeburg-aug-26-strike
cd seeburg-aug-26-strike

# 1. frontend
cd apps/web
npm ci
cd ../..

# 2. agent
cd apps/agent
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cd ../..

# 3. environment files (both are gitignored)
cp apps/agent/.env.example apps/agent/.env.local
cp apps/web/.env.example   apps/web/.env.local
```

### Setup — Windows (PowerShell)

```powershell
git clone https://github.com/Manasi200801/seeburg-aug-26-strike
cd seeburg-aug-26-strike

# 1. frontend
cd apps\web
npm ci
cd ..\..

# 2. agent
cd apps\agent
py -3 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
cd ..\..

# 3. environment files (both are gitignored)
Copy-Item apps\agent\.env.example apps\agent\.env.local
Copy-Item apps\web\.env.example   apps\web\.env.local
```

The venv interpreter lands in `.venv/bin/python` on macOS and Linux, and `.venv\Scripts\python.exe` on Windows. `npm run dev` detects both, so you do not have to tell it which.

### Run both apps

From the repo root:

```bash
npm run dev
```

That starts the Next.js dev server and the uvicorn orchestrator together and interleaves their output with a coloured `[web  ]` / `[agent]` prefix on every line. Ctrl+C stops both. If one dies, it says so and stops the other rather than hanging.

- web: http://localhost:3000
- agent: http://localhost:8000 (health check at `/health`)

Ports are configurable, and the web app is automatically told which agent port to talk to:

```bash
# macOS / Linux
WEB_PORT=3001 AGENT_PORT=8023 npm run dev
```

```powershell
# Windows (PowerShell)
$env:WEB_PORT=3001; $env:AGENT_PORT=8023; npm run dev
```

`AGENT_ENDPOINT` is derived from `AGENT_PORT` and passed into the web process, and an inherited environment variable wins over `apps/web/.env.local` — so moving the agent port moves both halves. Set `AGENT_ENDPOINT` explicitly if you need to point at an agent running somewhere else.

To run just one app, `cd apps/web && npm run dev` or `cd apps/agent && uvicorn app.main:app --reload --port 8000` still work exactly as before.

## Running without AWS

Worth doing first — see the whole flow before touching credentials.

**Option A — fake backends in the agent.** The three backend switches default to the offline implementations, so the simplest version of this is to not create `apps/agent/.env.local` at all. If you copied `.env.example` (which is set up for live AWS), set these three back:

```
SAP_BACKEND=fake
EXTRACT_BACKEND=sample
JUDGE_BACKEND=fake
```

`FakeSap` and `FakeJudge` answer from the Lab 06 demo data, so the full batch flow works end to end: five invoices park, and `FPL-9999` blocks on the missing purchase order `4500009999`. `FakeSap` reproduces the `17401710` vs `BP1710` Business Partner mismatch on purpose, because a fake that quietly agreed would hide the one case worth testing.

**Option B — mock the frontend entirely.** Set `MOCK=1` in `apps/web/.env.local` and the UI replays a scripted run with no backend at all. Leaving `AGENT_ENDPOINT` unset does the same thing. This is also the demo fallback: if SAP or the venue network dies, `MOCK=1` and the run still plays.

Direct-to-S3 upload is the one part that always needs real AWS credentials, since it presigns against a real bucket.

## Environment Variables

Two files, both gitignored, both copied from the `.env.example` next to them. **`apps/agent/.env.example` is the reference** — it documents where every value comes from (which Workshop Studio output, which script printed it, which Secrets Manager entry).

### `apps/agent/.env.local`

| Variable | Default | What it is |
| --- | --- | --- |
| `SAP_BACKEND` | `fake` | `fake` or `mcp`. `mcp` needs Lab 05 deployed and `AGENT_RUNTIME_ARN` set |
| `EXTRACT_BACKEND` | `sample` | `sample` or `bedrock`. `bedrock` needs `INVOICE_BUCKET` and Bedrock access |
| `JUDGE_BACKEND` | `fake` | `fake` or `bedrock`. `bedrock` needs Bedrock access, optionally `SOP_KNOWLEDGE_BASE_ID` |
| `AWS_PROFILE` | — | `workshop`. Credentials resolve through the standard chain |
| `AWS_REGION` | `us-east-1` | |
| `AWS_ACCOUNT_ID` | `516359819848` | Used to derive the SAP invoice reference base |
| `SAP_BASE_URL` | — | From the Workshop Studio `WebGuiURL`, with the OData base path swapped in |
| `AGENT_RUNTIME_ARN` | — | Printed by `deploy_mcp_server.py`. Set explicitly because the workshop participant role cannot read it back from SSM |
| `BEDROCK_MODEL_ID` | — | `us.anthropic.claude-sonnet-4-6` |
| `INVOICE_BUCKET` | `516359819848-invoice` | From Workshop Studio, `InvoiceBucketName` |
| `SOP_KNOWLEDGE_BASE_ID` | — | Without it rule 9 falls back to a flat 5% tolerance and says so |
| `ALLOWED_ORIGINS` | `http://localhost:3000` | CORS allowlist for the orchestrator |

The Cognito client id and secret are deliberately absent — they are read at runtime from Secrets Manager (`sap_mcp_server/cognito/oauth2_config`).

### `apps/web/.env.local`

| Variable | What it is |
| --- | --- |
| `AGENT_ENDPOINT` | Where the orchestrator is. Unset means the scripted mock. `npm run dev` sets this for you |
| `AGENT_TOKEN` | Only if the orchestrator sits behind an authenticating gateway. Not needed locally |
| `MOCK` | `1` forces the mock even when `AGENT_ENDPOINT` is set |
| `AWS_REGION` | Used by `/api/upload` to presign |
| `INVOICE_BUCKET` | Used by `/api/upload` to presign |
| `SOP_BUCKET` | Bucket the `/sops` page manages — list, read, write SOP files |
| `SOP_KNOWLEDGE_BASE_ID` | Knowledge base the `/sops` page's "Sync knowledge base" button re-indexes |

The invoice bucket needs a CORS rule allowing `PUT` from your origin or the browser blocks the upload — the workshop stack does not create one. The minimum rule is in `contract/events.md`. It is already configured for `http://localhost:3000`, `http://127.0.0.1:3000` and `https://*.vercel.app`.

## Checks

Same commands CI runs (`.github/workflows/ci.yml`).

```bash
# frontend, from apps/web
npm run lint        # biome check .
npm run typecheck   # tsc --noEmit
npm test            # vitest run
npm run build
```

```bash
# agent, from apps/agent (with the venv active)
python tests/test_run.py     # 6 checks, no test framework needed
```

The agent checks run against the fake SAP and judge backends, so they need no AWS credentials and stay green whether or not Lab 05 is deployed.

## Knowledge Bases

Both Bedrock Knowledge Bases are built by one script — an S3 vector bucket, an index, the knowledge base, a data source, then ingestion:

```bash
cd apps/agent
python scripts/make_kb.py sops      # AP standard operating procedures, read by rule 9
python scripts/make_kb.py sap-api   # SAP OData specs, Lab 02 deliverable, not read at runtime
```

Needs `boto3 >= 1.40` for the `s3vectors` client. Re-running is safe; existing resources are detected rather than duplicated. Watch the skipped-document count it prints at the end — an ingestion job reports `COMPLETE` even when every document was skipped for an unsupported file type, which produces an empty knowledge base that looks healthy.

## Team

| Name | Role | GitHub |
| --- | --- | --- |
| Manasi Atul Patil | Developer | Manasi200801 |
| Sharan Shyamsundar | Developer | Sharan1712 |
| Shivam Suchak | Developer | @username |
| Siddharth Prakash Pai | Developer | SiddharthPrakashPai |
| Sreehari Pradeep Kumar | Developer | sreehari59 |

## Results

Generated outputs for the example prompts are in the /result/ folder:

- result/example-1/ - Output for Example Prompt 1
- result/example-2/ - Output for Example Prompt 2

## Acknowledgments

Built for Seeburg Hackathon 2026, on the AWS Autonomous SAP Accounts Payable challenge and its workshop labs.
