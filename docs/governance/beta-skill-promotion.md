# Beta Skill Promotion Guide

## Maturity Levels

- `beta`: Skill is functional but may have incomplete documentation, limited test coverage, or evolving interfaces.
- `stable`: Skill is production-ready with complete documentation, tests, and stable interfaces.

## Promotion Checklist

A skill may be promoted from `beta` to `stable` when all of the following are satisfied:

1. [ ] **Documentation**: SKILL.md is complete with usage examples and trigger conditions
2. [ ] **Tests**: Has associated tests or eval harness demonstrating correct behavior
3. [ ] **Frontmatter**: Contains `name`, `description`, and `status: stable`
4. [ ] **References**: All `references/` files are up to date
5. [ ] **Host Compatibility**: Verified on at least one target host (Claude Code, Codex, Kimi, etc.)
6. [ ] **Naming**: Uses `gxpm-` prefix for official gxpm skills

## How to Mark Status

Add to the YAML frontmatter of `SKILL.md.tmpl` (for generated skills) or `SKILL.md` (for static skills):

```yaml
---
name: gxpm-example
description: Example skill
status: beta
---
```

When promoting, change `status: beta` to `status: stable` and regenerate `SKILL.md` if applicable:

```bash
bun run gen:skill-docs
```

## Enforcement

`bun run check` validates that every official skill (`gxpm-*`) has a valid frontmatter with `name` and `description`. Warnings are emitted for non-`gxpm-` skills but do not block the check.
