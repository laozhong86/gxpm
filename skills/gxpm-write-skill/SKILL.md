---
name: gxpm-write-skill
type: reference
description: Create new gxpm skills with proper structure, progressive disclosure, and bundled resources. Use when user wants to create, write, or build a new skill.
---

**Announce at start:** "I am using the gxpm-write-skill skill to create a new gxpm skill with proper structure, progressive disclosure, and bundled resources."

# Write a Skill

Create new agent skills that follow gxpm conventions.

## When to trigger（入口条件）

**何时触发**
- 用户说 "create a skill"、"write a skill"、"new skill"。
- 需要为 gxpm 生态添加新能力。
- 需要审核或改进现有 skill 的结构。

**Skill 边界**
- 需要 skill 质量评估 → `/gxpm-eval`
- 需要更新 skills-lock → `/maintain-hygiene-skills-lock`

## 可操作流程

### 1. Gather requirements

Ask the user:

- What task/domain does the skill cover?
- What specific use cases should it handle?
- Does it need executable scripts or just instructions?
- Any reference materials to include?

### 2. Draft the skill

Create:

```
skill-name/
├── SKILL.md           # Main instructions (required)
├── references/        # Detailed docs (if needed)
│   └── topic.md
└── scripts/           # Utility scripts (if needed)
    └── helper.ts
```

### 3. SKILL.md structure

```md
---
name: skill-name
description: Brief description. Use when [specific triggers].
---

# Skill Name

## When to trigger（入口条件）

**何时触发**
- ...

**Skill 边界（什么情况下应该加载别的 skill）**
- ...

## 可操作流程

[Step-by-step processes]

## Red Flags（红旗清单 / 反模式）

- **STOP：...**

## Verification（验证清单 / 出口条件）

- [ ] ...

**失败时路由**
- ...
```

### Description rules

The description is **the only thing your agent sees** when deciding which skill to load.

- Max 1024 chars
- Third person
- First sentence: what it does
- Second sentence: "Use when [specific triggers]"

**Good:**
```
Move issues through a state machine of triage roles. Use when user wants to create, review, or route issues.
```

**Bad:**
```
Helps with issues.
```

### When to split files

Split into `references/` when:

- SKILL.md exceeds 120 lines
- Content has distinct domains (finance vs sales schemas)
- Advanced features are rarely needed

### When to add scripts

Add utility scripts when:

- Operation is deterministic (validation, formatting)
- Same code would be generated repeatedly
- Errors need explicit handling

## Red Flags（红旗清单 / 反模式）

- **STOP：description 超过 1024 字符。** Agent 的上下文有限，过长的 description 降低匹配精度。
- **STOP：没有 "Use when" 触发句。** Agent 无法判断何时加载该 skill。
- **STOP：SKILL.md 超过 200 行还不拆分。** 使用 `references/` 子文件做渐进式披露。
- **STOP：缺少红旗清单或验证清单。** 每个 gxpm skill 必须包含这四个核心 section。

## Verification（验证清单 / 出口条件）

- [ ] Description ≤ 1024 chars，包含 "Use when..." 触发句。
- [ ] SKILL.md 包含：入口条件、可操作流程、红旗清单、验证清单。
- [ ] 如超过 120 行，已拆分为 `references/` 子文件。
- [ ] 术语与 `CONTEXT.md` 一致。
- [ ] 运行 `bun run check` 通过（skills-lock hash 已更新）。

**失败时路由**
- Skill 质量评估 → `/gxpm-eval`
- 需要更新 skills-lock → `/maintain-hygiene-skills-lock`

## Read Next

- `/gxpm-eval` — verify the skill scores
- `docs/governance/skill-authoring.md`
- `docs/governance/template-authoring.md`
