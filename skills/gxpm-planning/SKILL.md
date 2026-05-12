---
name: gxpm-planning
description: Break plans into independently-grabbable issues using vertical slices. Use when user wants to convert a plan into issues, create implementation tickets, break down a feature, or turn discussion into a structured PRD.
---

# Planning

Break any plan into independently-grabbable issues using **tracer-bullet vertical slices**.

## 入口条件

**何时触发**
- 用户想将计划转化为 issues。
- 用户要求创建 implementation tickets。
- 用户需要拆分 feature 为可执行单元。
- 用户希望将讨论转化为结构化 PRD。
- `plan` 阶段中 `implementation-plan` 过大，需要拆分为子 issue。

**前置条件**
- 已有计划、spec、或 PRD；或可从当前对话上下文中合成。

**Skill 边界（什么情况下应该加载别的 skill）**
- 需求或术语尚未澄清 → `/gxpm-grill`
- 架构决策需要分析 → `/gxpm-architecture`
- 具体代码实现 → `/gxpm-implementer`
- Issue 分类与状态路由 → `/gxpm-triage`

## 可操作流程

### 垂直切片规则

- Each slice delivers a narrow but **COMPLETE** path through every layer (schema, API, UI, tests).
- A completed slice is demoable or verifiable on its own.
- Prefer many thin slices over few thick ones.

### Slices may be HITL or AFK

- **HITL** — requires human interaction (architectural decision, design review).
- **AFK** — can be implemented and merged without human interaction.
- Prefer AFK over HITL where possible.

### Process

1. **Gather context** — read the plan, spec, or PRD. Fetch from the issue tracker if referenced.
2. **Explore codebase** (optional) — understand current state to inform slice titles.
3. **Draft vertical slices** — break into end-to-end slices, NOT horizontal layers.
4. **Quiz the user** — present as numbered list with:
   - Title
   - Type (HITL / AFK)
   - Blocked by (dependencies)
   - User stories covered
5. **Iterate** until user approves granularity and dependencies.
6. **Publish** — create issues in dependency order (blockers first). Apply `needs-triage` label.

### Issue body template

```markdown
## Parent
Reference to parent issue (if applicable).

## What to build
Concise description of this vertical slice. Describe end-to-end behavior, not layer-by-layer implementation.

## Acceptance criteria
- [ ] Criterion 1
- [ ] Criterion 2

## Blocked by
- Reference to blocking ticket, or "None — can start immediately"
```

### To PRD: Synthesize from Context

Turn the current conversation context into a PRD. Do NOT interview the user — synthesize what you already know.

#### PRD Template

```markdown
## Problem Statement
The problem from the user's perspective.

## Solution
The solution from the user's perspective.

## User Stories
1. As an <actor>, I want a <feature>, so that <benefit>
(Extensive list covering all aspects.)

## Implementation Decisions
- Modules to build/modify
- Interfaces to modify
- Schema changes
- API contracts

## Testing Decisions
- What makes a good test (behavior, not implementation)
- Which modules to test

## Out of Scope
Explicitly excluded items.

## Further Notes
Any additional notes.
```

### gxpm integration

- During `plan`, if the `implementation-plan` is too large, use `/planning` to suggest vertical slices as sub-issues.
- Each sub-issue should be created with `gxpm issue create --auto-id`.
- The parent issue's `implementation-plan` should reference child issue IDs.
- For PRD synthesis, publish the PRD as a new issue with `gxpm issue create --auto-id` and label it `needs-triage`.

## 红旗清单 / 反模式

- **STOP：禁止水平层拆分。** 不要按 schema → API → UI → tests 分层拆 issue；必须是端到端垂直切片。
- **STOP：禁止跳过用户确认直接发布 issue。** 必须在用户批准粒度和依赖后再 publish。
- **STOP：禁止遗漏 blocked by 依赖声明。** 每个 slice 必须注明依赖或标记为无依赖。
- **STOP：禁止 thick slice。** 宁要多个薄切片，不要少数厚切片。
- **危险信号：** Issue body 描述的是层-by-layer 实现而非端到端行为 → 重写为垂直切片描述。
- **危险信号：** 子 issue 创建后父 issue 未引用子 issue IDs → 补全引用。

## 验证清单 / 出口条件

- [ ] 每个 slice 有明确 Title、Type（HITL/AFK）、Blocked by、覆盖的 User Stories。
- [ ] 用户已批准粒度和依赖关系。
- [ ] Issues 已按依赖顺序创建（blockers 优先）。
- [ ] 每个新 issue 已应用 `needs-triage` label。
- [ ] PRD 包含所有必需章节（Problem Statement、Solution、User Stories、Implementation Decisions、Testing Decisions、Out of Scope）。
- [ ] 父 issue 的 `implementation-plan` 引用了所有子 issue IDs。

**失败时路由**
- 需求仍不清晰 → `/gxpm-grill`
- 实现计划仍需进一步拆分 → 重新执行 Planning Process
- 架构决策受阻 → `/gxpm-architecture`
