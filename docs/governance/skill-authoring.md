# Skill Authoring Guide

> How to write, structure, and maintain gxpm skills.

## Skill Structure

```
skills/<category>/<name>/
├── SKILL.md           # Main instructions (required)
├── SKILL.md.tmpl      # Template source (if host-specific injection needed)
├── references/        # Reference docs for on-demand loading (optional)
│   └── detailed-guide.md
├── scripts/           # Utility scripts for Script-First architecture (optional)
│   └── helper.ts
└── REFERENCE.md       # Legacy detailed docs (deprecated, use references/)
```

## Two Types of Skills

### 1. Generated skills (`.tmpl`)

Use `.tmpl` when the skill needs host-specific injection or references/ loading:

```
skills/gxpm/SKILL.md.tmpl
```

Variables available during generation:
- `{{PREAMBLE}}` — host-aware env vars and target declaration
- `{{ARTIFACT_READ_COMMANDS}}` — `gxpm artifact read` commands for all phase gates
- `{{PHASE_GATE_COMMANDS}}` — `gxpm <phase> init` commands for all transitions
- `{{PHASE_TRANSITION_SUMMARY}}` — strict transition rules summary
- `{{REFERENCE:<name>}}` — inject content from `references/<name>.md`

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

Use `references/` for on-demand content that should not bloat the main SKILL.md:
- Detailed step-by-step templates
- Long examples or personas
- Data-heavy reference tables

In `.tmpl`, reference a file with `{{REFERENCE:filename}}` (reads `references/filename.md`).

## Review Checklist

After drafting, verify:
- [ ] Description includes triggers ("Use when...")
- [ ] SKILL.md under 100 lines (or split)
- [ ] No time-sensitive info
- [ ] Consistent terminology with CONTEXT.md
- [ ] Concrete examples included
- [ ] References one level deep
- [ ] gxpm integration section included (for phase-aware skills)
- [ ] references/ files are `.md` and named without spaces
- [ ] scripts/ are executable and documented in SKILL.md

## Preset Layer Support

Skills can be customized via the preset system without modifying core templates:

1. Create a preset: `gxpm preset init my-team`
2. Add rules to `.gxpm/presets/my-team/manifest.json` targeting skill output paths
3. Activate: `gxpm preset add my-team`
4. Regenerate: `bun run gen:skill-docs`

Preset strategies (`replace`, `prepend`, `append`, `wrap`) apply to generated skill output. See `docs/architecture/preset-system.md` for full manifest schema.

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
