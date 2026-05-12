# Skill Authoring Guide

> gxpm skills follow the **Five-Section Structure** adapted from unified-skills.
> Every `SKILL.md` must contain four required sections. Gatekeeping skills should also include the fifth optional section.

---

## Five-Section Structure

### Required Sections

Each `SKILL.md` must have these sections (use `##` or `###` heading):

#### 1. 入口条件 / Entry Conditions

- When should this skill be loaded?
- What triggers it? (user utterances, phase transitions, failure modes)
- What are the preconditions?
- Skill boundary: what should the agent load *instead* of this skill?

#### 2. 可操作流程 / Process

- Numbered or bulleted steps the agent follows
- Concrete actions, not vague advice
- Include exact commands where applicable
- Reference external docs with relative paths

#### 3. 红旗清单 / Red Flags

- Behaviors that violate this skill's discipline
- Anti-patterns specific to this domain
- STOP conditions — when to halt and escalate
- Common rationalizations and why they are wrong

#### 4. 验证清单 / Verification / Exit Conditions

- Checklist the agent must complete before claiming success
- Evidence that must be produced
- Exit criteria: what artifact or state confirms completion?
- Failure routing: which skill to load when a check fails?

### Optional Section (Recommended for Gatekeeping Skills)

#### 5. 常见说辞表 / Common Phrases

- Table mapping common user/agent utterances to recommended responses
- Helps shape consistent behavior across sessions
- Especially valuable for review, triage, planning, and ship skills

---

## Frontmatter

```yaml
---
name: gxpm-<skill>
description: <One sentence. Must contain "Use when" trigger phrase. 20-300 chars.>
---
```

- `name`: kebab-case, prefixed with `gxpm-` for core skills
- `description`: must include "Use when" to help agents recognize triggers

## Template-Generated Skills

Skills with `SKILL.md.tmpl` are template-generated. Edit the `.tmpl` file, then run:

```bash
bun run gen:skill-docs
```

Never edit the generated `SKILL.md` directly. Generated artifacts are not truth sources.

## Checking Compliance

```bash
bun run check
```

This runs `skill-structure-check.ts` which validates every `SKILL.md` under `skills/`.

## Examples

See `skills/gxpm-tdd/SKILL.md` and `skills/gxpm-verify/SKILL.md` for well-structured examples.
