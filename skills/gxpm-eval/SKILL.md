---
name: gxpm-eval
description: Skill quality evaluation harness for static analysis. Use when adding a new skill, modifying skill structure, auditing skill quality, or checking for governance compliance.
---

# gxpm-eval

Lightweight static analysis for gxpm skills. Checks frontmatter completeness,
trigger sections, description quality, and reference links.

## gxpm-eval

- After creating or modifying a skill
- During `self-review` or `qa` phase before shipping skill changes
- When `bun run check` reports skill doc drift

## Commands

```bash
gxpm-eval list                         # list all discoverable skills
gxpm-eval run                          # eval all skills
gxpm-eval run gxpm-diagnose            # eval one skill
gxpm-eval run --json                   # machine-readable output
```

## Scoring rubric

Each skill is scored on 6 dimensions (10 points each):

| Check | Pass criteria |
|-------|---------------|
| frontmatter | Has YAML `---` block |
| name | `name:` field present and non-empty |
| description | 20-300 characters |
| triggers | Has `## When to trigger` or `## Commands` |
| length | 10-1000 lines |
| references | Has `## Read Next` or `## References` |

Overall pass threshold: ≥ 50%.

## Integration

Add to `gxpm-check` or CI:

```bash
bun run scripts/eval.ts run --json
```

## Limitations

- Static analysis only (no LLM output quality scoring yet).
- Does not verify that skill content is correct — only that structure is sound.

## Read Next

- `docs/governance/skill-authoring.md`
- Main `/gxpm` skill for skill toolchain overview
