# Design: Autonomous SAP Accounts Payable

**Date:** 2026-08-06
**Challenge:** Topic 3 (AWS) — Autonomous SAP Accounts Payable, From Invoice Chaos to One-Click Posting
**Scope:** Frontend design, plus the backend architecture and event contract it depends on.
**Deadline:** Presentations 7 Aug 2026, 14:00.

The event contract lives in `contract/events.md` and is the shared interface. This document
explains the reasoning behind it.

---

## 1. Context

### What the challenge asks for

A non-technical Accounts Payable clerk uploads a batch of supplier invoices, chats with an agent,
approves once, and every valid invoice is parked in SAP as a draft Supplier Invoice (MIR7).
Invalid invoices are skipped with a business-readable explanation.

Criteria bearing on this work:

- Batch flow end to end: upload → extract → validate → single approval → post
- Exactly one approval gate before any write-back
- Exception intelligence: failures caught, skipped, and explained in plain business language
- Driven by natural-language chat, no SAP transaction-code knowledge required
- Parked MIR7 per passing invoice, uniquely tagged and traceable to the run

The brief also warns: *"Automation completeness over polish — a full working batch flow beats a
beautiful UI that only handles one invoice."* The frontend therefore optimises for making a
complete batch legible, not for richness on a single invoice.

### Judging weights

Technical Implementation 25% · Innovation & Creativity 20% · Business Value 20% ·
User Experience 15% · Presentation Quality 10% · Challenge Fit 10%.

### The UI design direction does not apply

`challenges/README.md` states the binding UI direction covers *both DMI topics*. Topic 3 is
provided by AWS, so `challenges/ui-design-direction.md` (Material 3, dark-only, `#B71818`,
"avoid decorative motion") does not constrain this work.

### What the AWS workshop actually provides — and why it changes the strategy

The workshop (*ERP Exception Management*, Roche use case) contains six labs. **Lab 06 is this
challenge**, and its intended interface is **Amazon Quick**, AWS's console chat product,
configured with a persona prompt.

Two consequences.

First, every competing team following the workshop will demo the same generic AWS chat console.
A purpose-built interface is therefore not polish; it is the differentiator on Innovation, User
Experience, and Presentation.

Second, Amazon Quick is a console product. It cannot be embedded, called from our application, or
streamed from. Lab 06 is not a backend we can reuse — it is a **specification** we implement:

| Lab | Provides | Reusable |
|---|---|---|
| 03 | Strands agent + MCP client code | Yes — the runtime |
| 05 | AWS for SAP MCP Server (`sapmcp02`) | Yes — SAP connectivity |
| 06 | Persona prompt, 16 rules, field mapping, park payload | Yes — as the spec |
| 06 | Amazon Quick as the interface | No — replaced by our application |

---

## 2. Architecture

The 2026 consensus for regulated agentic systems is that policy belongs in code, judgment belongs
in the model, and the boundary between them is recorded for every transaction — a deterministic
state machine wrapped around a rule engine, with model-driven sub-agents handling reasoning where
deterministic logic gives up.

That is the architecture here, in four layers.

### Layer 1 — State machine (code)

```
uploaded → extracting → validating → awaiting-approval → posting → done
                                                       ↘ failed
```

Owns the event stream, the approval gate, and the SAP write. No model output can cause a
transition. This is what makes the single approval gate structural rather than an instruction a
model might disregard: `/api/approve` is a separate request, and the state machine rejects it
unless the run is in `awaiting-approval`.

### Layer 2 — Rule engine (code)

The rules where SAP returns a definitive answer: PO exists, PO open, PO line item exists, company
code, currency, quantity tolerance, `line = qty × price`, `gross = Σ lines + tax`, goods receipt
exists, GR quantity, tax code valid, duplicate reference. Twelve of sixteen.

These are comparisons. A model adds latency and doubt and nothing else. Rules in code are also
countable and testable, which is what the challenge's "15+ business rules" criterion actually
rewards; rules living inside a prompt are neither.

### Layer 3 — Agent judgment, where code gives up

- **Extraction** — any invoice layout, no templates, per-field confidence
- **Identity resolution (rule 4)** — invoices carry vendor `17401710`, the PO reports `BP1710`.
  Hardcoding that mapping is exactly the brittleness this challenge exists to remove. The agent
  resolves it by reading SAP and stating the link.
- **Material matching (rule 7)** — description variants against the PO material
- **Tolerance judgment (rule 9)** — a price inside PO tolerance may still breach policy; the
  agent consults the SOP knowledge base
- **Explanation** — plain business language, in the run's locale
- **Resolution proposal** — the stretch goal. PO not found → search SAP for open,
  goods-receipted POs matching vendor, material and amount, and propose one.

Extract, resolve, and explain are separate sub-agents, which satisfies the multi-agent stretch
goal honestly rather than by relabelling one prompt.

### Layer 4 — Evidence

Every rule result carries `decidedBy: "rule" | "agent"`, its inputs, the SAP field it read, and —
for agent decisions — the reasoning and any SOP citation. This is the logged boundary between
policy and judgment, and it costs nothing extra: it is the event stream.

### What runs where

```
browser ──presigned PUT──────────────────────► S3 516359819848-invoice
   │
   └── POST /api/chat ──► Next route handler ──► orchestrator (Python, AWS)
                                                    ├── Bedrock (extract, explain, resolve)
                                                    ├── AWS for SAP MCP Server ──► SAP S/4HANA
                                                    └── Bedrock Knowledge Bases (SOPs, API specs)
```

The Next.js route handler is a thin proxy: it hides credentials, isolates the frontend from
AWS-side churn, and lets the frontend run against a local mock until the backend lands.

---

## 3. Repository shape

```
seeburg-aug-26-strike/
  apps/web/               Next.js frontend
  apps/agent/             Python orchestrator, rules, sub-agents
  apps/agent/reference/   The workshop's six scripts, unmodified, for provenance
  contract/events.md      The shared interface
```

No Turborepo, Nx, or workspace tooling: two languages, no shared JavaScript, nothing to hoist.

---

## 4. Stack

| Concern | Choice | Reason |
|---|---|---|
| Framework | Next.js App Router | Route handler is the proxy |
| Streaming / chat | Vercel AI SDK (`useChat`) | Streaming and generative UI for free |
| Styling | Tailwind CSS | |
| i18n | `next-intl`, `en` + `de` | |
| Lint + format | Biome | One tool, one config, replaces ESLint + Prettier |
| Tests | Vitest | |
| Hosting | Vercel | The challenge requires the *agent* on AWS, not the UI |
| Model | Bedrock, Sonnet 5 or Opus 5 | Both enabled in the account; the workshop pins Sonnet 4.5 |

---

## 5. Interaction model

Chat is the only entry point. Agent responses render as real components inline — a batch table,
per-invoice validation chips, a live SAP call rail, one approval card, a posting log — rather
than as text.

This satisfies "driven by natural-language chat" literally while keeping a batch reviewable,
which prose cannot do.

Rejected: a dashboard with a chat sidecar (chat reads as bolted on against a criterion that says
the flow is chat-driven), and a split chat + canvas (more build effort, and the canvas duplicates
state that belongs in the transcript).

### Layout

One route. No sidebar.

```
header:  STRIKE AP     5 ready · 1 blocked · 96 checks · period 2025-03 · EN|DE

[agent]  Extracted 6 invoices from 6 files.

  INV                PO            VENDOR      NET       CHECKS  STATUS     │ SAP
  FPL-SAMPLE-0001    4500001463    10300006     50.00     16/16  ready      │ GET A_PurchaseOrder('…1463')
  FPL-1563           4500001563    17401710    113.50     16/16  ready      │ GET …/to_PurchaseOrderItem
  FPL-1638           4500001638    17401710    113.50     16/16  ready      │ GET A_MaterialDocumentItem…
  FPL-1650           4500001650    17401710    113.50     16/16  ready      │
  FPL-1697           4500001697    17401710    113.50     16/16  ready      │
  FPL-9999           4500009999    —             —         1/16  blocked    │
    Purchase order 4500009999 does not exist in SAP.
    This invoice cannot be matched to an order, so it cannot be parked.
    Vendor 17401710 has one open, goods-receipted order for the same
    material and amount: 4500001712.
    [ Use 4500001712 ]  [ Send to buyer ]  [ Ask why ]

  ┌──────────────────────────────────────────────┐
  │ Approve & park 5 invoices                 →  │
  │ Parked as drafts. Reversible. Nothing paid.  │
  └──────────────────────────────────────────────┘
  1 excluded

composer: drop invoices or ask a question
```

The right-hand rail streams `tool-call` events — the agent's actual SAP reads, as they happen.
It is the cheapest possible proof that the run is live rather than simulated, and it is the most
convincing single element on screen for a technical jury.

---

## 6. Users

The challenge names one operator. Designing for three would serve none of them.

| Persona | Relationship | What they get |
|---|---|---|
| **AP clerk** (primary) | Operates the tool; the whole demo is from her seat | The application |
| **Buyer / procurement** | Never opens it; receives escalations | One action on the blocked card, producing a prefilled mail |
| **AP lead** | Wants evidence month-end effort dropped | The summary strip; also the observability stretch goal |

---

## 7. User journey

**Beat 0 — arrival.** An empty chat box asks the user to be inventive, which is the wrong demand
on a clerk at the end of a close day. The empty state shows a drop target, three concrete seeded
prompts, and a **Load sample batch** button.

**Beat 1 — drop.** File chips appear in under 100ms, before any parsing. Receipt is acknowledged
separately from work being done. Upload progress per file comes from the presigned PUTs.

**Beat 2 — extraction.** A spinner reading "extracting…" is a black box, and black boxes are what
clerks already distrust about automation. Rows appear as each invoice is extracted; the growing
list is the progress indicator.

**Beat 3 — validation.** A bare `16/16` is a magic number. The count expands into named rules,
each marked as rule-decided or agent-decided. Agent chips expand further to show reasoning and
any SOP citation. Trust comes from checks a user can name and interrogate, not from a score.

**Beat 4 — the failure.** The differentiator, per the brief. Three layers: plain-language cause,
business impact, available actions — including the agent's proposed correction where it has one.

**Beat 5 — the approval gate.** A large button with a count floating above it creates hesitation,
because the user is not certain what they are agreeing to. The label carries the whole sentence,
with `Parked as drafts. Reversible. Nothing is paid.` beneath and `1 excluded` beside it. The
excluded invoice is visibly excluded, never silently dropped.

**Beat 6 — posting.** A "done" confirmation proves nothing. Each row flips to `parked` with its
real SAP document number, fiscal year, and unique reference, in sequence. Traceability is a
stated criterion, so it is made visible rather than merely true.

**Beat 7 — aftermath.** Summary strip, **Copy run report**, and the blocked invoice still present
and still awaiting action. Ending on an unresolved item demonstrates that the system does not
pretend to have finished work it has not done.

---

## 8. Trust principles

1. **No naked numbers.** Every score expands into named rules.
2. **Show who decided.** Rule-decided and agent-decided are visually distinct. Agent decisions
   expose their reasoning.
3. **Show provenance.** Which PO, goods receipt, and vendor record each row matched. Extraction
   below the confidence threshold is marked, not presented as certain.
4. **Consequences on the control, not above it.**
5. **Reversibility stated explicitly.** Parked means reversible, and the UI says so.
6. **Failures never blame the user.** "Purchase order does not exist", not "Invalid invoice".
7. **Excluded is not hidden.**

---

## 9. Visual direction

A dark, precise instrument: near-black canvas, hairline dividers, a single restrained accent,
tabular numerals throughout. Credible for financial work, strong on a projector, maximum contrast
for status colour.

```
canvas    #0A0A0B      dividers  #1F1F26
accent    brass, used only for primary action and parked state
status    a single green / amber / red trio, used only for status
type      system UI for prose, monospace for all data and SAP identifiers
```

---

## 10. Motion

The tool runs a handful of times per day, so animation is justified. Elements touched constantly —
typing, hovering, keyboard actions — stay instant.

```css
--ease-out:    cubic-bezier(0.23, 1, 0.32, 1);
--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
```

| Element | Properties | Duration / easing | Notes |
|---|---|---|---|
| File chip on drop | `opacity`, `scale` .96→1 | 120ms `--ease-out`, 30ms stagger | Direct response; must stay under 150ms |
| Invoice row enter | `opacity`, `translateY` 6px→0 | 220ms `--ease-out` | Stagger comes from event arrival |
| Rule chip tick | `opacity`, `scale` .94→1 | 140ms `--ease-out` | Colour arrives with the scale, never before |
| Tool-call rail line | `opacity`, `translateY` 4px→0 | 160ms `--ease-out` | Oldest lines fade to 40% |
| Score `16/16` | none | — | `tabular-nums`, direct swap; an odometer roll reads as a gimmick on financial figures |
| Blocked row | `background-color` to error tint | 200ms `ease` | Chips halt mid-sequence. No shake, ever |
| Reason panel | `grid-template-rows` 0fr→1fr | 240ms `--ease-out` | Auto height without JS measurement |
| Approval press | `transform: scale(.97)` | 160ms `--ease-out` | `:active` |
| Approval label swap | `filter: blur(2px)`, `opacity` .7 | 200ms `ease` | Width reserved or the control jumps |
| Posting row | status crossfade, SAP ref `translateX` 4px→0 | 180ms `--ease-out`, 60ms stagger | Sequential deliberately; the payoff |
| Progress bar | `transform: scaleX` | `linear` | The one correct use of linear |
| Row hover | `background-color` | 100ms `ease` | Behind `@media (hover: hover) and (pointer: fine)` |
| Composer focus | `border-color` | 100ms `ease` | No transform; typing must feel instant |
| Language toggle | crossfade with `blur(2px)` | 200ms `ease` | German runs ~30% longer; status chips need `min-width` |

Only `transform`, `opacity`, `filter`, `background-color`, and `border-color` are animated.

Under `prefers-reduced-motion: reduce`, every translate, scale, and stagger is removed. Opacity
and colour transitions remain, because here they carry meaning rather than decoration.

**Pacing lives in the backend.** Row and chip animations are driven by event arrival. The
contract requires a ~60ms floor between `rule` events and ~110ms between `invoice` events. With
that in place the frontend writes no stagger logic for streamed content, and the cascade cannot
collapse into a single frame.

---

## 11. i18n

`next-intl` with `en.json` and `de.json` for interface strings. The locale is sent in the request
body, and the agent writes its explanations in that language.

Demo value: switching to German mid-run returns the next explanation in German, which sells the
Swiss AP clerk framing in three seconds.

---

## 12. Mock-first development

`apps/web/src/lib/mock-run.ts` replays a scripted event stream at realistic timings, including
the pacing floors.

Two purposes. During development the entire interface is built and demonstrable before the
backend exists, so neither team blocks the other. During the presentation `?mock=1` remains
available as the only fallback — the team decided against maintaining an Amazon Quick path, so
if SAP write-back fails on the day, the mock demonstrates the product but posts nothing to SAP.

---

## 13. Testing and CI

One workflow, one job, on pull request and push to `main`:

```
biome ci .      lint and format
tsc --noEmit    types
vitest run      tests
next build      build
```

Three tests, each chosen because its failure mode would otherwise surface during the demo:

1. **Event-stream parser** survives a malformed or unknown event without blanking the interface.
2. **Status derivation** maps a rule set to `ready` or `blocked` correctly.
3. **Locale key parity** between `en.json` and `de.json`.

Excluded: Docker for the web application (Vercel builds from a git push; no runtime would consume
the image — the Python agent's container is decided in `apps/agent/`), and Husky/lint-staged (CI
enforces the same checks, and pre-commit hooks fail at the least convenient moment).

---

## 14. Known traps

Detailed in `contract/events.md`. Summarised because each one can end the demo:

- **Posting period.** `DocumentDate` and `PostingDate` must be `2025-03-15`. Today's date fails.
- **Re-run duplicates.** The invoice reference must be unique per vendor; a second run reusing
  `-1` trips rule 16 and blocks the batch. Derive the sequence base from the run.
- **Business Partner mapping.** Invoices carry `17401710`, the PO reports `BP1710`. Naive string
  equality on rule 4 fails all five valid invoices.
- **Bucket CORS.** Not configured by the workshop stack; browser presigned PUT is blocked without
  it.

---

## 15. Out of scope

Authentication, run persistence and history, an embedded PDF viewer, light mode, mobile layouts,
multi-user support. None are scored and none appear in the demo.

---

## 16. Build order

| Step | Work | Estimate |
|---|---|---|
| 1 | Event contract and mock stream | 1h |
| 2 | Shell, composer, upload, streaming against the mock | 2h |
| 3 | Batch table, validation chips with provenance, tool-call rail | 2.5h |
| 4 | Approval card and posting log | 1.5h |
| 5 | Motion pass | 1.5h |
| 6 | i18n | 1h |
| 7 | Swap the mock for the live endpoint, polish | 2h |

Step 1 is a dependency for the backend team as well, so it is written and shared first.

---

## 17. Demo structure

Nine minutes. Three moments carry it.

1. **0:30** — six PDFs dropped in; the table fills while the presenter is still speaking, and the
   SAP call rail starts moving.
2. **2:00** — validation chips cascade, agent-decided chips visibly distinct, one row turns red
   mid-cascade. The presenter stops talking and lets the room read the explanation and the
   proposed correction.
3. **4:00** — one click; five SAP document numbers land in sequence, followed by the real SAP
   screen showing the parked documents.

The language toggle closes it, and the summary strip supports the business-value segment, for
which Lab 06 supplies the before/after figures: 15–20 minutes per invoice down to under one,
5–10% rework down to near zero, one-at-a-time replaced by a whole batch per upload.

Rehearse at least once against `?mock=1`, and at least once against live SAP — the second live
run is where the duplicate-reference trap fires.
