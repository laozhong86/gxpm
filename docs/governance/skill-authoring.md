# Skill Authoring Guide

> How to write, structure, and maintain gxpm skills.

## Skill Structure

```
skills/<category>/<name>/
├── SKILL.md           # Main instructions (required)
├── REFERENCE.md       # Detailed docs (if needed)
├── EXAMPLES.md        # Usage examples (if needed)
└── scripts/           # Utility scripts (if needed)
    └── helper.sh
```

## Two Types of Skills

### 1. Generated skills (`.tmpl`)

Use `.tmpl` when the skill needs host-specific injection:

```
skills/gxpm/SKILL.md.tmpl
```

Variables available during generation:
- `{{PREAMBLE}}` — host-aware env vars and target declaration
- `{{ARTIFACT_READ_COMMANDS}}` — `gxpm artifact read` commands for all phase gates
- `{{PHASE_GATE_COMMANDS}}` — `gxpm <phase> init` commands for all transitions
- `{{PHASE_TRANSITION_SUMMARY}}` — strict transition rules summary

Generated output goes to the same path without `.tmpl`:
```
skills/gxpm/SKILL.md   (generated from .tmpl)
```

### 2. Static skills (`.md`)

Use `.md` when the skill is pure text instructions with no host-specific variables:

```
skills/diagnose/SKILL.md
```

Static skills are copied as-is during `gen:skill-docs` and installed verbatim.

## SKILL.md Format

```md
---
name: skill-name
description: Brief description of capability. Use when [specific triggers].
---

# Skill Name

## Quick start
[Minimal working example]

## Workflows
[Step-by-step processes with checklists for complex tasks]

## Advanced features
[Link to separate files: See [REFERENCE.md](REFERENCE.md)]
```

## Description Requirements

The description is **the only thing your agent sees** when deciding which skill to load.

- Max 1024 chars
- Write in third person
- First sentence: what it does
- Second sentence: "Use when [specific triggers]"

Good:
```
Disciplined diagnosis loop for hard bugs and performance regressions. Use when user says 'diagnose this', 'debug this', reports a bug, or describes a performance regression.
```

Bad:
```
Helps with debugging.
```

## When to Add Scripts

Add utility scripts when:
- Operation is deterministic (validation, formatting)
- Same code would be generated repeatedly
- Errors need explicit handling

## When to Split Files

Split into separate files when:
- SKILL.md exceeds 100 lines
- Content has distinct domains
- Advanced features are rarely needed

## Review Checklist

After drafting, verify:
- [ ] Description includes triggers ("Use when...")
- [ ] SKILL.md under 100 lines (or split)
- [ ] No time-sensitive info
- [ ] Consistent terminology with CONTEXT.md
- [ ] Concrete examples included
- [ ] References one level deep
- [ ] gxpm integration section included (for phase-aware skills)

## Installation

All skills in `skills/` are discovered automatically:

```bash
bun run gen:skill-docs    # generate .tmpl → .md
bun run dev:skill         # watch mode
```

Install to host:

```bash
gxpm-init --install-skill --host all
```

## Category Conventions

| Category | Purpose | Examples |
|----------|---------|----------|
| `gxpm` | Core runtime skill | `gxpm` |
| `graph` | Code intelligence skills | `debug-issue`, `explore-codebase` |
| *(direct)* | Engineering disciplines | `diagnose`, `grill`, `tdd`, `architecture`, `planning`, `triage` |
