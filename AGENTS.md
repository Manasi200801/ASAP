# AGENTS.md

Development rules for AI coding agents (Claude Code, Codex, Cursor, etc.) working in this repo.
This file is the source of truth — `CLAUDE.md` just points here so Claude Code and Codex stay in sync.

## Project

- DMI Hackathon 2026, Seeburg Kreuzlingen. Kickoff and final presentation: 6-7 Aug 2026.
- Challenge: Topic 3, provided by AWS — **Autonomous SAP Accounts Payable**. Full brief:
  `hackathon-seeburg-2026/challenges/topic-3-aws.md` in the guide repo.
  - Build an AI-powered invoice processing agent: business users upload supplier invoices, agent
    validates them against live SAP S/4HANA data, posts approved invoices automatically.
  - Must support: batch processing, business-rule validation, clear exception reporting, and a
    single human approval step before anything is posted.
- Repo naming, `hackmaster-dmi` read-only collaborator, and submission rules live in the guide repo's
  `checklists/members.md` — do not duplicate them here, just follow them.

## Stack

TBD — fill in once the team picks one.

## Git workflow

- Branch per feature/fix, PR into `main`. Don't push straight to `main`.
- Branch naming: `<type>/<short-desc>` (`feat/`, `fix/`, `setup/`, `chore/`).
- Commit messages: short, imperative, describe the "why" when it's not obvious from the diff.
- Never force-push, `reset --hard`, or delete branches without asking first.
- New commit over `--amend` unless told otherwise.

## Security

- Never commit secrets, API keys, or AWS credentials. Use `.env` (already gitignored) +
  `.env.example` with placeholder values.
- No hardcoded credentials anywhere in source — this is explicitly called out as a scoring
  deduction in the hackathon's judging notes.

## Code quality bar (this is literally how the repo gets scored post-event)

- No mocked/placeholder implementations left in by submission time.
- Real error handling on anything that can fail during a live demo.
- README stays current: what it is, how to run it, env vars needed.
- Keep the repo lean — no videos/large binaries committed (host externally, link in README).

## Skills available in this repo

Vendored under `.agents/skills/<name>/SKILL.md` (universal — Codex, Cursor, etc.) and mirrored to
`.claude/skills/<name>/SKILL.md` (Claude Code's native path). Same content, two locations, no plugin
install required. Third-party skills keep their upstream license under `.agents/skills-licenses/`.

**Process (use these to shape how you work, not just what you build):**

| Skill | Use for |
|---|---|
| `brainstorming` | Turning a rough idea into an approved design before writing code |
| `writing-plans` | Turning an approved design into a concrete step-by-step implementation plan |
| `executing-plans` | Working through an implementation plan methodically |
| `systematic-debugging` | Any non-trivial bug — root-cause first, not symptom patching |
| `test-driven-development` | Writing tests alongside logic instead of after |
| `verification-before-completion` | Checking your own work before calling it done |

**Frontend / design craft:**

| Skill | Use for |
|---|---|
| `frontend-design` | General UI implementation quality (Anthropic's official skill) |
| `emil-design-eng` | Animation + design judgment, Emil Kowalski's main skill |
| `animate` | Building one animation from scratch (curve, duration, properties) |
| `animation-vocabulary` | Describing the animation you want precisely, so the agent nails it first try |
| `apple-design` | Apple HIG-style interface/motion principles for the web |
| `find-animation-opportunities` | Where motion would genuinely help — and where to leave it alone |
| `improve-animations` | Auditing existing animations in the codebase, prioritized fix plan |
| `review-animations` | Strict pass/fail review of animation work against a rules list |
| `pick-ui-library` | Choosing a real, trusted UI/toast/component library instead of hand-rolling one |
| `prototype` | Spinning up multiple UI variants of one component to compare |

**Requirements / spec / debugging (Matt Pocock):**

| Skill | Use for |
|---|---|
| `grill-me` + `grilling` | Relentless Q&A to stress-test a plan/idea before building it — round-based, one frontier of questions at a time |
| `research` | Investigating an unknown before committing to an approach |
| `to-spec` | Turning a grilled-out idea into a written spec |
| `implement` | Executing a spec/plan into code |
| `domain-modeling` | Modeling the problem domain (e.g. invoices, SAP entities, approval states) before coding |
| `diagnosing-bugs` | Root-causing a bug (companion to `systematic-debugging`) |
| `triage` | Sorting a pile of issues/bugs by what actually matters before the deadline |
| `code-review` | Reviewing a diff/PR |
| `resolving-merge-conflicts` | Untangling a merge conflict between teammates' branches |
| `git-guardrails-claude-code` | Sets up Claude Code hooks that block `push --force`, `reset --hard`, `clean -f`, `branch -D` before they run — enforces the git rules above at the tool level |

**Other (vendored on request, not hackathon-critical):**

`writing-beats`, `writing-fragments`, `writing-shape` — Matt Pocock's article-writing pipeline
(explore → ground → shape). `scaffold-exercises`, `migrate-to-shoehorn`, `setup-ts-deep-modules` —
his course/TS-tooling scaffolding, only relevant if the stack ends up TypeScript-heavy.

Use with whatever your agent's skill-invocation mechanism is (Claude Code: the `Skill` tool reading
`.claude/skills/<name>/SKILL.md`; other agents: read `.agents/skills/<name>/SKILL.md` directly when
the task matches).

### Keeping skills up to date

Emil Kowalski's and the official frontend-design skill can be refreshed with:

```bash
npx skills@latest update --project
```

This repo pins versions in `skills-lock.json`. Don't run `update` mid-hackathon unless a skill is
actually broken — a version change during a demo crunch is not worth the risk.
