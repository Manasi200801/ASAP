# apps/web

The interface. Consumes `contract/events.md` and renders a run as it happens.

## Run it

First-time setup is in the root `README.md`. From the repo root, `npm run dev`
starts this and the orchestrator together. To run only this half:

```bash
cd apps/web
npm run dev
```

With `AGENT_ENDPOINT` unset, or `MOCK=1`, it replays a scripted run from
`src/lib/mock-run.ts` and needs no backend at all. That is how the interface was
built before the agent existed, and it is the fallback on the day: if SAP or the
venue network dies, set `MOCK=1` and the demo still plays.

```bash
npm run lint        # biome
npm run typecheck   # tsc --noEmit
npm test            # vitest
```

## Shape

```
src/
  app/
    page.tsx           the whole screen
    api/chat/          proxies to the agent, or replays the mock
    api/approve/       the only route that leads to a SAP write
    api/upload/        presigns S3 PUTs so PDFs never touch this server
  components/
    batch-table.tsx    one row per invoice, status derived live
    rule-chips.tsx     the evidence trail: rule vs agent, reasoning, citation
    call-rail.tsx      SAP calls as they happen
    approval-card.tsx  the single human gate
    composer.tsx       upload and ask
  lib/
    events.ts          Zod mirror of the contract
    use-run.ts         the reducer over the event stream
    sse.ts             the stream reader
    i18n.ts            en/de
```

## Two things that look like bugs and are not

**Animation is driven by event arrival, not CSS delays.** The agent paces its
emission — roughly 60ms between rules, 110ms between invoices — so the cascade
writes no stagger logic here at all. If validation ever collapses into a single
frame, the pacing upstream broke, not the styling.

**Row status is derived from the chips, not from `invoice-status`.** A row must
turn red on the failing chip, mid-cascade, rather than after the run settles —
that moment is the point of the whole interface. `deriveStatus` in `events.ts`
owns it, and `parked` never regresses.

## Streaming

`readEventStream` in `sse.ts` is about thirty lines and parses SSE directly. No
AI SDK: the contract is ours, the events are ours, and a library that assumed a
chat-shaped stream would be fighting a run-shaped one.

The same applies to i18n. One page and one language toggle is two JSON files and
a lookup, not a routing library.

## Talking to the agent

| Variable | Effect |
|---|---|
| `AGENT_ENDPOINT` | unset replays the mock; set proxies to the orchestrator |
| `MOCK=1` | forces the mock even when `AGENT_ENDPOINT` is set |
| `AGENT_TOKEN` | sent as a bearer token, for a deployed orchestrator |
| `INVOICE_BUCKET`, `AWS_REGION` | used by `/api/upload` to presign |

`npm run dev` from the repo root derives `AGENT_ENDPOINT` from `AGENT_PORT`, so
one variable moves both halves.

Uploads go straight from the browser to S3, which means **the bucket needs a CORS
rule allowing PUT from this origin** or the browser blocks it. The workshop stack
does not create one; the rule is in `contract/events.md`.
