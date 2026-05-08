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

Each skill is scored on 9 dimensions. Pass threshold: ≥ 60%.

### Universal checks (all skill types)

| Check | Points | Pass criteria |
|-------|--------|---------------|
| frontmatter | 10 | Has YAML `---` block |
| name | 10 | `name:` field present and non-empty |
| description | 10 | 20-300 characters **and** contains "Use when" trigger phrase |
| triggers | 10 | Has `## When to trigger` or `## Commands` |
| length | 10 | 10-1000 lines (warn if >100 without `references/`) |
| references | 10 | Has `## Read Next` or `## References` |

### Type-specific checks

| Check | Points | Pass criteria |
|-------|--------|---------------|
| **Discipline** skills | 10 | Has `## Red Flags` AND `## Rationalization Table` AND explicit negation (`**No exceptions:**`) |
| **Pattern** skills | 10 | Has `## Recognition criteria` AND `## When NOT to apply` AND `## Counter-examples` |
| **Reference** skills | 10 | Has concrete command examples with expected output |

A skill missing its type-specific structures loses the full 10 points for that dimension.

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
