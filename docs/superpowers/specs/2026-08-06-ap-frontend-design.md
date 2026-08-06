# Design: Autonomous SAP Accounts Payable — Frontend

**Date:** 2026-08-06
**Challenge:** Topic 3 (AWS) — Autonomous SAP Accounts Payable, From Invoice Chaos to One-Click Posting
**Scope:** Frontend only. The Bedrock agent, SAP MCP integration, and validation rules are built in parallel by teammates.
**Deadline:** Presentations 7 Aug 2026, 14:00.

---

## 1. Context and constraints

### What the challenge asks for

A non-technical Accounts Payable clerk uploads a batch of supplier invoices, chats with an agent,
approves once, and every valid invoice is parked in SAP as a draft Supplier Invoice (MIR7). Invalid
invoices are skipped with a business-readable explanation.

Success criteria that bear directly on the frontend:

- End-to-end batch flow: upload → extract → validate → single approval → post, for multiple invoices in one run.
- Exactly one approval gate before any write-back.
- Exception intelligence: the failing invoice is caught, skipped, and explained in plain business language.
- The whole thing is driven by natural-language chat; no SAP transaction-code knowledge required.
- Correct write-back: a parked MIR7 per passing invoice, tagged with a unique reference and traceable to the run.

### What the challenge warns against

> "Automation completeness over polish — a full working batch flow beats a beautiful UI that only handles one invoice."

The frontend therefore optimises for *making a complete batch flow legible*, not for visual richness
on a single invoice.

### Judging weights

| Criterion | Weight |
|---|---|
| Technical Implementation | 25% |
| Innovation & Creativity | 20% |
| Business Value / Impact | 20% |
| User Experience | 15% |
| Presentation Quality | 10% |
| Challenge Fit | 10% |

UX is 15%, but Presentation Quality (10%) and Innovation (20%) are also carried by the demo surface.

### UI design direction does not apply

`challenges/README.md` states: "Both **DMI** topics share the same binding UI design direction."
Topic 3 is provided by AWS, so `challenges/ui-design-direction.md` (Material 3, dark-only,
`#B71818` primary, "avoid decorative motion") is **not binding here**. The visual direction below is
chosen freely.

---

## 2. Repository shape

Single repository, two application folders, no monorepo tooling.

```
seeburg-aug-26-strike/
  apps/web/            Next.js frontend
  apps/agent/          Python: Bedrock agent + SAP MCP integration
  contract/events.md   Shared event contract, read by both sides
  docs/superpowers/specs/
```

Turborepo, Nx, and workspace tooling are deliberately excluded: the two applications are written in
different languages, share no JavaScript code, and have nothing to hoist. The configuration cost is
not repaid within the project timeline.

The contract between the two halves is a documented JSON event shape, not a shared type package.
The frontend mirrors it in a Zod schema; the agent mirrors it in Pydantic.

---

## 3. Stack

| Concern | Choice | Reason |
|---|---|---|
| Framework | Next.js App Router | Server route handler acts as the proxy to AWS |
| Streaming / chat | Vercel AI SDK (`useChat`) | Streaming and generative-UI plumbing for free |
| Backend transport | One Next route handler proxying to the teammates' AWS endpoint | Hides credentials, isolates the frontend from AWS-side churn |
| Styling | Tailwind CSS | |
| i18n | `next-intl`, `en` + `de` | |
| Lint + format | Biome | One tool, one config, replaces ESLint + Prettier |
| Tests | Vitest | |
| Hosting | Vercel | The challenge requires the *agent* on AWS, not the UI |

The frontend talks to exactly one backend surface, so it can be developed against a local mock until
the AWS side is ready.

---

## 4. Interaction model

Chat is the only entry point. The agent's responses render as real components inline — a batch
table, per-invoice validation chips, a single approval card, a posting log — rather than as text.

This satisfies the "driven by natural-language chat" criterion literally while keeping a
twelve-invoice batch reviewable, which pure text cannot do.

Rejected alternatives:

- **Dashboard with a chat sidecar.** Denser, but chat reads as bolted on against a criterion that
  says the flow is chat-driven.
- **Split chat + live canvas.** More cinematic, materially more build effort, and the canvas
  duplicates state that already belongs in the transcript.

### Layout

One route. No sidebar, no separate dashboard.

```
header:  STRIKE AP        11 ready · 1 blocked · 12 rules · EN|DE

[agent]  Extracted 12 invoices from 12 files.

  INV-1042  ACME AG        4500001234   12,480.00   12/12   ready
  INV-1043  ACME AG        4500001234    8,210.00   12/12   ready
  INV-1044  NORDIC GmbH    4500001299    9,905.00    9/12   blocked
    Unit price is 41.80, the PO says 36.50 — 14.5% over, tolerance is 5%.
    On 220 units that is 1,166.00 more than ordered.
    [ Send to buyer ]  [ Show PO line ]  [ Ask why ]

  ┌──────────────────────────────────────────────┐
  │ Approve & park 11 invoices                →  │
  │ Parked as drafts. Reversible. Nothing paid.  │
  └──────────────────────────────────────────────┘
  1 excluded

composer: drop invoices or ask a question
```

---

## 5. Event contract

One streaming endpoint. The backend emits typed events; the frontend renders each as a component.

`POST /api/chat` — proxies to the AWS agent endpoint, streams events back.

| Event | Payload | Renders as |
|---|---|---|
| `batch` | `runId`, `invoices[]` | table skeleton, rows appear |
| `rule` | `invoiceId`, `ruleId`, `label`, `status: pass \| fail`, `detail` | one validation chip |
| `invoice-status` | `invoiceId`, `status: ready \| blocked`, `reason` | row settles |
| `summary` | `ready`, `blocked`, `rulesRun`, `minutesSaved` | summary strip |
| `approval` | `runId`, `readyIds[]` | the approval card |
| `posting` | `invoiceId`, `status: parking \| parked \| error`, `sapRef` | posting log row |
| text delta | prose | the agent's message |

`POST /api/approve` — body `{ runId }`, streams `posting` events.

Approval is a **separate request**, not a message in the chat stream. This makes the single-approval
gate structural: nothing can be posted without a distinct second call from the client.

### Emission pacing is part of the contract

`rule` events must be emitted with a floor of approximately **60ms** between them.

The frontend's validation cascade is driven by event arrival, not by mount order. If the agent
flushes all rule events in a single tick, the cascade collapses into one frame and the validation
step becomes visually indistinguishable from a spinner. Pacing the emission means arrival order *is*
the stagger, and the frontend writes no stagger logic for streamed rows at all.

This is the highest-leverage item to agree with the backend team, and it must be agreed early.

---

## 6. Users

The challenge names one operator. Designing for three personas in the available time would serve
none of them well.

| Persona | Relationship to the product | What they get |
|---|---|---|
| **AP clerk** (primary) | Operates the tool. The entire demo is from her seat. | The whole application |
| **Buyer / procurement** | Never opens the tool. Receives the escalation when a price mismatch needs re-approval. | One action on the blocked card: *Send to buyer*, producing a prefilled mail. No screen of their own. |
| **AP lead / finance manager** | Wants evidence that month-end effort dropped. | The run summary strip. Also satisfies the challenge's observability stretch goal. No dashboard. |

---

## 7. User journey

Eight beats. Each names the gap it closes.

**Beat 0 — arrival.** An empty chat box asks the user to be inventive, which is the wrong demand on
a clerk at the end of a close day. The empty state therefore shows a drop target, three concrete
seeded prompts, and a **Load sample batch** button.

**Beat 1 — drop.** Twelve files upload while the screen sits still, and the user cannot tell whether
it registered. File chips appear in under 100ms, before any parsing begins. Receipt is acknowledged
separately from work being done.

**Beat 2 — extraction.** A spinner reading "extracting…" for eight seconds is a black box, and black
boxes are precisely what AP clerks already distrust about automation. Rows therefore appear as each
invoice is extracted. The growing list *is* the progress indicator.

**Beat 3 — validation.** A bare `12/12` is a magic number. The count expands into named rules — PO
exists, vendor matches, GR posted, price within tolerance, quantity within tolerance, currency
matches, not a duplicate. Trust comes from rules a user can name, not from a score.

**Beat 4 — the failure.** The challenge states that exception intelligence is the differentiator.
The blocked invoice is explained in three layers: plain-language cause, monetary impact, available
actions.

```
INV-1044   NORDIC GmbH   9/12   blocked
  Unit price is 41.80, the PO says 36.50 — 14.5% over, tolerance is 5%.
  On 220 units that is 1,166.00 more than ordered.
  [ Send to buyer ]  [ Show PO line ]  [ Ask why ]
```

The monetary impact is stated explicitly because every finance user converts a percentage into
currency mentally; doing it for them is the difference between a technical message and a business
one.

**Beat 5 — the approval gate.** A large button with a count floating above it creates hesitation,
because the user is not certain what they are agreeing to. The button label carries the whole
sentence — `Approve & park 11 invoices` — with `Parked as drafts. Reversible. Nothing is paid.`
directly beneath it, and `1 excluded` beside it. The excluded invoice is visibly excluded, never
silently dropped.

**Beat 6 — posting.** A "done" confirmation proves nothing. Each row flips to `parked` with a real
SAP reference, in sequence, and the run reference is copyable. Traceability is a stated success
criterion, so it is made visible rather than merely true.

**Beat 7 — aftermath.** The run ends with a summary strip (`11 parked · 1 blocked · 147 rules run ·
~3h 40m saved`), a **Copy run report** action, and the blocked invoice still present and still
awaiting its action. Ending on an unresolved item is deliberate: it demonstrates that the system
does not pretend to have finished work it has not done.

---

## 8. Trust principles

1. **No naked numbers.** Every score expands into named rules.
2. **Show provenance.** Hovering a row reveals which PO, goods receipt, and vendor record it matched.
   Extraction below the confidence threshold is marked rather than presented as certain.
3. **State consequences on the control, not above it.** The button label carries the outcome.
4. **State reversibility explicitly.** Parked means reversible, and the UI says so, because the jury
   scores safety and trust directly.
5. **Failures never blame the user.** "Price exceeds PO", not "Invalid invoice".
6. **Excluded is not hidden.** Blocked invoices remain on screen throughout posting.
7. **No fabricated certainty.** A guessed vendor match is labelled as a guess.

---

## 9. Visual direction

A dark, precise instrument: near-black canvas, hairline dividers, restrained accent colours,
tabular numerals throughout. This reads as credible for financial work, projects well in a demo
room, and gives status colour maximum contrast.

```
canvas      #0A0A0B
dividers    #1F1F23
type        Inter or Geist, tabular-nums on all figures
status      a single green / amber / red trio, used only for status
```

Colour is reserved for status. Nothing else is coloured.

---

## 10. Motion

The tool is run a handful of times per day, not hundreds, so animation is justified. The elements
touched constantly — typing, hovering, keyboard actions — remain instant.

```css
--ease-out:    cubic-bezier(0.23, 1, 0.32, 1);
--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
```

| Element | Properties | Duration / easing | Notes |
|---|---|---|---|
| File chip on drop | `opacity` 0→1, `scale` .96→1 | 120ms `--ease-out`, 30ms stagger | Direct response to user action; must stay under 150ms |
| Invoice row enter | `opacity`, `translateY` 6px→0 | 220ms `--ease-out` | Stagger comes from event arrival, not CSS |
| Rule chip tick | `opacity`, `scale` .94→1 | 140ms `--ease-out` | Colour arrives with the scale, never before it |
| Score `9/12` | none | — | `tabular-nums`, direct swap; a rolling odometer reads as a gimmick on financial figures |
| Blocked row | `background-color` to error tint | 200ms `ease` | Chips halt mid-sequence. No shake under any circumstance |
| Reason panel | `grid-template-rows` 0fr→1fr | 240ms `--ease-out` | Auto-height without JS measurement; text fades in at 100ms delay |
| Approval button press | `transform: scale(.97)` | 160ms `--ease-out` | `:active` |
| Approval label swap | `filter: blur(2px)`, `opacity` .7 | 200ms `ease` | Button width must be reserved or the control jumps |
| Posting row | status crossfade, SAP ref `translateX` 4px→0 | 180ms `--ease-out`, 60ms stagger | Sequential deliberately; this is the payoff moment |
| Progress bar | `transform: scaleX` | `linear` | The one correct use of linear easing |
| Row hover | `background-color` | 100ms `ease` | Gated behind `@media (hover: hover) and (pointer: fine)` |
| Composer focus | `border-color` | 100ms `ease` | No transform; typing must feel instant |
| Language toggle | crossfade with `blur(2px)` | 200ms `ease` | German strings run roughly 30% longer; status chips need `min-width` or the table jolts |

Only `transform`, `opacity`, `filter`, `background-color`, and `border-color` are animated.

**Reduced motion.** Under `prefers-reduced-motion: reduce`, every translate, scale, and stagger is
removed. Opacity and colour transitions remain, because here they carry meaning rather than
decoration.

---

## 11. Mock-first development

`apps/web/src/lib/mock-run.ts` replays a scripted event stream with realistic timings, including the
60ms rule-event floor.

This serves two purposes. During development, the entire interface can be built and demonstrated
before the AWS backend exists, so neither team blocks the other. During the presentation, `?mock=1`
remains available: if SAP access or venue networking fails, the demo proceeds unchanged.

The mock and the real backend emit the same event shapes, so the swap is a single environment
variable.

---

## 12. Testing and CI

One workflow, one job, on pull request and on push to `main`:

```
biome ci .      lint and format
tsc --noEmit    types
vitest run      tests
next build      build
```

Three tests, chosen because each one fails in a way that would otherwise surface during the demo:

1. **Event-stream parser** survives a malformed or unknown event without blanking the interface.
2. **Status derivation** maps a rule set to `ready` or `blocked` correctly.
3. **Locale key parity** between `en.json` and `de.json`, which catches a missing German string
   before it appears on stage.

Deliberately excluded:

- **Docker for the web application.** Vercel builds from a git push; no runtime would consume the
  image. The Python agent may require a container for Lambda or AgentCore, which is decided in
  `apps/agent/`.
- **Husky and lint-staged.** CI already enforces the same checks, and pre-commit hooks fail at the
  least convenient moment during a time-boxed build.

---

## 13. Out of scope

Authentication, run persistence and history, an embedded PDF viewer, light mode, mobile layouts, and
multi-user support. None are scored, and none appear in the demo.

---

## 14. Build order

| Step | Work | Estimate |
|---|---|---|
| 1 | Event contract document and mock stream | 1h |
| 2 | Application shell, composer, streaming wired to the mock | 2h |
| 3 | Batch table, validation chips, status derivation | 2h |
| 4 | Approval card and posting log | 1.5h |
| 5 | Motion pass | 1.5h |
| 6 | i18n (`en` / `de`) | 1h |
| 7 | Swap the mock for the live AWS endpoint, polish | 2h |

Step 1 is the dependency for the backend team as well as the frontend, so it is written first and
shared immediately.

---

## 15. Demo structure

Nine minutes. Three moments carry it.

1. **0:30** — twelve PDFs are dropped in; the table fills while the presenter is still speaking.
2. **2:00** — validation chips cascade and one row turns red mid-cascade. The presenter stops
   talking and lets the room read the explanation.
3. **4:00** — one click; eleven SAP references land in sequence, followed by the real SAP screen
   showing the parked documents.

The language toggle follows as a closing detail, and the summary strip supports the business-value
segment.

The run is rehearsed at least once against `?mock=1`.
