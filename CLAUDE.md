# CLAUDE.md

Read `AGENTS.md` first — it's the source of truth for this repo's dev rules (project context, stack,
git workflow, security, skills). This file only adds Claude-Code-specific notes.

## Skills

All skills listed in `AGENTS.md` are available under `.claude/skills/<name>/SKILL.md` — invoke with
the `Skill` tool when a task matches. Process skills (`brainstorming`, `writing-plans`,
`systematic-debugging`, etc.) take priority over implementation skills: brainstorm/plan before
building, especially once the AWS brief drops and there's an actual feature to design.

## Before touching `main`

Confirm before force-push, `reset --hard`, or branch deletion — same rule as `AGENTS.md`, repeated
here because it matters most on shared branches under hackathon time pressure.
