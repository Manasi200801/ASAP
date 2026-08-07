# Invoice bucket lifecycle

Design, 7 Aug 2026.

An invoice PDF now has a life: it arrives in one bucket, and once a human has decided about it, it
leaves for one of two others. This spec covers that lifecycle, the browser upload that starts it,
and the human override that the AI's block no longer forecloses.

## Why

Two gaps, one of which was invisible.

The visible one: nothing moves. A processed invoice and an untouched one sit in the same place, so
"what still needs attention?" cannot be answered from the bucket.

The invisible one: the browser never uploaded anything. `/api/upload` presigned PUT URLs that no
caller ever requested, `onFiles` kept `f.name` and dropped the bytes, and `use-run.ts` sent
`keys: []` on every request. `extract_batch` falls back to six hardcoded invoices when `keys` is
empty — so a clerk could drop real PDFs, watch a plausible run complete, and be looking entirely at
Lab 06 sample data. It reads as success. That fallback is what this spec closes.

## Buckets

| Bucket | Holds | Written by | Deleted from |
|---|---|---|---|
| `516359819848-invoice` | The six workshop PDFs | nobody | **never** |
| `516359819848-uploaded-invoice` | Whatever a clerk drops | browser, presigned PUT | yes, as invoices settle |
| `516359819848-processed-invoice` | Parked in SAP | agent | no |
| `516359819848-blocked-invoice` | Explicitly rejected by a human | agent | no |

Names come from `INVOICE_BUCKET`, `UPLOAD_BUCKET`, `PROCESSED_BUCKET`, `BLOCKED_BUCKET`. No bucket
name is hardcoded outside a default.

## Addressing two source buckets

`extract_batch` took bare keys against one hardcoded bucket. Two buckets are now readable, so a key
becomes an `s3://bucket/key` URI. A bare key still resolves against `UPLOAD_BUCKET`, so the existing
contract keeps working.

`Extracted` gains `source: str` — the URI the invoice was read from, empty in sample mode. Whatever
files the PDF later needs to know exactly where it came from, and guessing from the filename is how
you delete the wrong object.

This makes the "Load batch" button real. It sends the six
`s3://516359819848-invoice/fpl-invoice-0N.pdf` URIs, so the demo path runs actual Bedrock extraction
over actual PDFs. The transcribed `_SAMPLE` list survives only as the no-AWS path
(`EXTRACT_BACKEND=sample`).

## Human override

The AI's block was terminal: `run.blocked` was never parked and Approve covered only `run.ready`.
It is now a recommendation a human can overturn.

Blocked rows carry two actions, **Override** and **Reject**. Neither posts anything by itself; they
mark the row. `/approve` grows to `{runId, overrideIds[], rejectIds[]}` and `post_run` parks
`run.ready + overrideIds`.

An override is a real approval, not a reclassification — the invoice goes to SAP and SAP's answer is
reported verbatim. Overriding rule 1 on a purchase order that does not exist will fail at SAP, and
that failure is the honest outcome; `post_run` already handles `SapError` per invoice without
stopping the batch.

The brief's "single human approval step" survives intact: still one gate, one write path, one press.
Marking a row is not a decision until Approve is pressed.

## Filing

After the posting loop, per invoice:

| Outcome | Destination |
|---|---|
| Parked — whether ready or overridden | `-processed-invoice` |
| Explicitly rejected by a human | `-blocked-invoice` |
| Blocked and undecided | stays in `-uploaded-invoice` |
| Overridden, but SAP refused the park | stays in `-uploaded-invoice` |

The last row is deliberate. No human rejected those, and SAP may accept a retry once the underlying
problem is fixed, so filing them as blocked would be a verdict nobody reached.

The key is preserved verbatim across the move, so one file is traceable by name alone. S3 has no
move: copy, confirm, then delete. A failed move is logged and surfaced but never fails the run —
the invoice is already parked in SAP, and a misfiled PDF must not make a successful posting look
broken.

## Two safety rules

Both guard the same disaster, from different directions.

**Never delete outside `UPLOAD_BUCKET`.** Without it, the "Load batch" demo path would move the six
workshop PDFs out of `-invoice` on its first successful run and destroy the fallback permanently,
for the whole account rather than one machine. The mover refuses any delete whose source bucket is
not the upload bucket, and says so in the log.

**No source URI, no move.** Sample mode, and any invoice whose `source` is empty, is skipped
silently rather than guessed at.

## Events

One new event, `filed`: `{invoiceId, bucket, key, status}`. The UI shows where each PDF landed, so
the archive is visible rather than inferred. `contract/events.md` carries the shape.

## Testing

`FakeMover` alongside `FakeSap` and `FakeJudge`, recording moves instead of calling S3, so routing
is testable with no AWS. Cases:

- ready, park succeeds → `-processed-invoice`
- overridden, park succeeds → `-processed-invoice`
- overridden, park fails → stays
- explicitly rejected → `-blocked-invoice`
- blocked, undecided → stays
- source in `-invoice` → copied, never deleted

## AWS-side

Done ahead of implementation, verified against the workshop account:

- CORS on `-uploaded-invoice` (PUT/GET/HEAD from `localhost:3000`, `127.0.0.1:3000`, `*.vercel.app`),
  copied from the rule already on `-invoice`. The other two buckets need none — no browser talks to
  them.
- `WSParticipantRole` confirmed able to PutObject and DeleteObject on `-uploaded-invoice` and
  CopyObject into both archives.
