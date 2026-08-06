# Run Event Contract

The single interface between `apps/agent` (Python, AWS) and `apps/web` (Next.js).

Both sides implement this document. The frontend mirrors it in Zod, the agent in Pydantic.
Change it here first, then on both sides.

---

## Endpoints

### `POST /api/upload`

Request: `{ "runId": string, "files": [{ "name": string, "size": number }] }`

Response: `{ "uploads": [{ "name": string, "key": string, "url": string }] }`

`url` is a presigned S3 PUT valid for 15 minutes. The browser uploads each file directly to
`s3://516359819848-invoice/runs/<runId>/<name>`. Files never pass through the Next.js server.

**Bucket CORS is required** and is not configured by the workshop stack. Without it the browser
PUT is blocked. Minimum rule:

```json
[{
  "AllowedOrigins": ["http://localhost:3000", "https://<our-vercel-domain>"],
  "AllowedMethods": ["PUT"],
  "AllowedHeaders": ["*"],
  "ExposeHeaders": ["ETag"]
}]
```

### `POST /api/chat`

Request: `{ "runId": string, "keys": string[], "locale": "en" | "de", "message"?: string }`

Response: an SSE stream of the events below. Read-only — this endpoint never writes to SAP.

### `POST /api/approve`

Request: `{ "runId": string, "readyIds"?: string[] }`

`readyIds` omitted or empty parks every ready invoice still outstanding; a subset parks only
those rows (a single invoice's own approve button). An invoice already parked by an earlier call
is skipped rather than parked twice, so individual and "approve all" calls can be mixed freely on
the same run. The run only reaches `done` once every ready invoice has been parked, however many
separate calls that took - one row parked out of five leaves the run in `awaiting-approval`.

Response: an SSE stream of `tool-call` and `posting` events.

Approval is a **separate request**, not a message in the chat stream. This makes the
single-approval gate structural: nothing can be written to SAP without a distinct second call
from the client. The state machine rejects `/api/approve` unless the run is in
`awaiting-approval`.

---

## Run states

```
uploaded → extracting → validating → awaiting-approval → posting → done
                                                       ↘ failed
```

Transitions are owned by the Python state machine. No model output can cause a transition.

---

## Events

Every event is a JSON object with a `type` field, sent as one SSE `data:` line.

### `batch`

Emitted once, then one `invoice` event per extracted invoice.

```json
{ "type": "batch", "runId": "r_8f3a", "reference": "516359819848-11", "count": 6 }
```

`reference` is the base SAP invoice reference for this run. Per-invoice references are
`<reference-base>-<n>`. See "Re-run safety" below.

### `invoice`

One per invoice, emitted as extraction completes. Do not batch these.

```json
{
  "type": "invoice",
  "invoiceId": "fpl-invoice-01",
  "file": "fpl-invoice-01.pdf",
  "supplierInvoiceId": "FPL-SAMPLE-0001",
  "vendor": "10300006",
  "vendorName": "Inlandslieferant DE 6 (Retouren)",
  "purchaseOrder": "4500001463",
  "purchaseOrderItem": "10",
  "material": "QM003",
  "quantity": "5",
  "unit": "PC",
  "unitPrice": "10.00",
  "netAmount": "50.00",
  "taxCode": "V1",
  "grossAmount": "59.50",
  "currency": "EUR",
  "companyCode": "1010",
  "confidence": { "purchaseOrder": 0.99, "vendor": 0.87 }
}
```

`confidence` is per field, from the extraction agent, range 0–1. Fields below 0.8 are marked in
the UI rather than presented as certain. Omit the key entirely when extraction was exact.

### `tool-call`

Emitted whenever the agent calls SAP through the MCP server. Forwarded from Strands tool
telemetry. Purely informational — the UI renders these in a live rail beside the table, and they
are what make the run visibly real rather than simulated.

```json
{
  "type": "tool-call",
  "invoiceId": "fpl-invoice-01",
  "method": "GET",
  "resource": "A_PurchaseOrder('4500001463')",
  "status": "ok",
  "ms": 412
}
```

`status` is `pending` on start and `ok` or `error` on completion, sent as two events with the
same `resource`.

### `rule`

One per rule evaluated, per invoice. **Emit with a floor of ~60ms between events.**

```json
{
  "type": "rule",
  "invoiceId": "fpl-invoice-01",
  "ruleId": 9,
  "label": "Unit price within tolerance",
  "status": "pass",
  "decidedBy": "rule",
  "detail": "10.00 = PO price 10.00",
  "evidence": "A_PurchaseOrderItem('4500001463','10').NetPriceAmount"
}
```

`status` — `pass` | `fail` | `skip`
`decidedBy` — `rule` (deterministic comparison) or `agent` (LLM judgment)
`reasoning` — optional, agent-decided rules only, one or two sentences
`citation` — optional, SOP knowledge base reference when the agent consulted policy

The UI renders `rule` and `agent` chips at different visual weights, and expands agent chips to
show `reasoning` and `citation`. This is the evidence trail: for every check, the record shows
whether code or a model decided it, and on what basis.

#### The pacing rule

The frontend's validation cascade is driven by event arrival, not by CSS delays. If all rule
events are flushed in one tick the cascade collapses into a single frame and validation becomes
visually indistinguishable from a spinner. Pace the emission and the frontend needs no stagger
logic at all.

Same applies to `invoice` events: a floor of ~110ms.

### `invoice-status`

One per invoice, after its rules complete.

```json
{
  "type": "invoice-status",
  "invoiceId": "fpl-invoice-06",
  "status": "blocked",
  "headline": "Purchase order 4500009999 does not exist in SAP.",
  "impact": "This invoice cannot be matched to an order, so it cannot be parked.",
  "detail": "Searched company code 1010. No purchase order with this number was found.",
  "suggestion": {
    "text": "Vendor 17401710 has one open, goods-receipted order for the same material and amount: 4500001712.",
    "action": "reassign-po",
    "value": "4500001712"
  }
}
```

`status` — `ready` | `blocked`
`headline` — plain business language, in the run's locale. No SAP error codes.
`impact` — the business consequence, in currency where the failure is monetary
`suggestion` — optional, the stretch-goal correction proposal

### `summary`

```json
{
  "type": "summary",
  "runId": "r_8f3a",
  "ready": 5,
  "blocked": 1,
  "rulesRun": 96,
  "agentDecided": 12,
  "minutesSaved": 105
}
```

### `approval`

Emitted last on `/api/chat`. The run is now in `awaiting-approval`.

```json
{ "type": "approval", "runId": "r_8f3a", "readyIds": ["fpl-invoice-01", "..."], "blockedIds": ["fpl-invoice-06"] }
```

### `posting`

On `/api/approve`, one or two per approved invoice.

```json
{
  "type": "posting",
  "invoiceId": "fpl-invoice-01",
  "status": "parked",
  "reference": "516359819848-11",
  "sapDocument": "5100001500",
  "fiscalYear": "2025"
}
```

`status` — `parking` | `parked` | `error`
`message` — on `error` only, plain language

Emit with a ~60ms floor. The sequential arrival is the payoff moment of the demo.

### `text`

Prose from the agent, streamed as deltas.

```json
{ "type": "text", "delta": "Extracted 6 invoices. Checking each against SAP." }
```

### `error`

Terminal. The run moves to `failed`.

```json
{ "type": "error", "message": "SAP is not responding.", "recoverable": false }
```

---

## The 16 validation rules

| # | Rule | Decided by |
|---|---|---|
| 1 | Purchase order exists | rule |
| 2 | PO is open (not blocked, deleted, or fully invoiced) | rule |
| 3 | PO line item exists | rule |
| 4 | Supplier / vendor matches | **agent** — Business Partner mapping, see below |
| 5 | Company code matches | rule |
| 6 | Currency matches | rule |
| 7 | Material matches | **agent** — description variants |
| 8 | Quantity within tolerance | rule |
| 9 | Unit price within tolerance | **agent** — consults SOP policy above PO tolerance |
| 10 | Line amount = qty × price | rule |
| 11 | Gross amount = Σ lines + tax | rule |
| 12 | Goods receipt exists | rule |
| 13 | GR quantity sufficient | rule |
| 14 | Tax code valid for company code | rule |
| 15 | *(to be filled from Lab 06 Step 3)* | — |
| 16 | Not a duplicate reference | rule |

Rules 4, 7, and 9 are where deterministic comparison gives up and judgment starts. Everything
else is arithmetic or lookup, and belongs in code.

---

## SAP write payload

`POST` to `A_SupplierInvoice` on `API_SUPPLIERINVOICE_PROCESS_SRV`, deep insert into
`to_SuplrInvcItemPurOrdRef`.

```json
{
  "CompanyCode": "1010",
  "DocumentDate": "/Date(1741996800000)/",
  "PostingDate": "/Date(1741996800000)/",
  "SupplierInvoiceIDByInvcgParty": "516359819848-11",
  "InvoicingParty": "10300006",
  "DocumentCurrency": "EUR",
  "InvoiceGrossAmount": "59.50",
  "SupplierInvoiceStatus": "A",
  "TaxIsCalculatedAutomatically": true,
  "to_SuplrInvcItemPurOrdRef": [{
    "SupplierInvoiceItem": "1",
    "PurchaseOrder": "4500001463",
    "PurchaseOrderItem": "10",
    "TaxCode": "V1",
    "DocumentCurrency": "EUR",
    "SupplierInvoiceItemAmount": "50.00",
    "QuantityInPurchaseOrderUnit": "5",
    "PurchaseOrderQuantityUnit": "PC"
  }]
}
```

`SupplierInvoiceStatus: "A"` parks the invoice as a reversible draft. It does not consume the
purchase order and creates no accounting entry. **Never post for payment.**

---

## Environment facts

| Fact | Value |
|---|---|
| AWS account | `516359819848` |
| Region | `us-east-1` |
| Invoice bucket | `516359819848-invoice` |
| SAP company code | `1010` (DE), plant `1010`, currency EUR |
| SAP credentials | Secrets Manager, `sap-s4h-credentials` |
| MCP server | AWS for SAP MCP Server (Lab 05), on AgentCore Runtime behind Cognito |
| SOP knowledge base | `NKB8KVAZ45` — over `-sops`, read by rule 9. Build: `scripts/make_kb.py sops` |
| SAP API knowledge base | `XVOHWDZ4UM` — over `-sap-api`, Lab 02 deliverable, not read at runtime |
| Demo POs | `4500001463`, `4500001563`, `4500001638`, `4500001650`, `4500001697` (item 10) |
| Deliberate failure | `4500009999` — does not exist |

---

## Three traps

### Posting period

`DocumentDate` and `PostingDate` **must** be `2025-03-15`. The workshop SAP books run in early
2025; today's date fails with a posting-period error. The UI surfaces the posting period as a
chip so the handling is visible rather than hidden.

### Re-run safety

`SupplierInvoiceIDByInvcgParty` must be unique per vendor. A second run reusing `-1` trips rule
16 and blocks the whole batch. This will happen during rehearsal.

Derive the sequence base from the run, not from a constant. The field is capped at 16
characters, so a 12-digit account ID leaves `-1` through `-99`.

### Business Partner mapping

The invoices carry vendor `17401710`; the purchase order reports `BP1710`. Naive string equality
on rule 4 fails all five valid invoices. This is why rule 4 is agent-decided: the agent resolves
the identity by reading SAP and states the link in its reasoning.

---

## Verified live, 6 Aug 2026

The whole path was exercised against the real workshop account, not mocks.

| Leg | Evidence |
|---|---|
| Presigned upload | `PUT` 200 to `s3://516359819848-invoice/runs/<runId>/`, browser preflight 200 |
| Extraction | Bedrock read all six FPL PDFs field-perfect |
| SAP reads | PO `4500001463` matched the invoice; `4500009999` correctly absent; GR `5000002033` |
| Judgment | The model resolved `17401710` vs `BP1710` and explained why |
| Approval gate | A second `/approve` on the same run is rejected |
| SAP write | Documents `5100001500` and `5100001501`, status `A`, gross `59.50 EUR`, not reversed |

MCP runtime: `arn:aws:bedrock-agentcore:us-east-1:516359819848:runtime/sap_mcp_server_1786023560-PTTQ1n8Y2J`
Model: `us.anthropic.claude-sonnet-4-6` — Sonnet 5 and Opus 5 are listed by
`list-inference-profiles` but Converse returns `AccessDenied` on this account.

Bucket CORS is configured for `http://localhost:3000`, `http://127.0.0.1:3000`
and `https://*.vercel.app`.
