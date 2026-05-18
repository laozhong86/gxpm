---
name: gxpm-grill
description: Grilling session that challenges plans against the domain model and sharpens terminology. Use when user wants to stress-test a plan, align on requirements, challenge assumptions, or make architecture decisions.
---
<!-- AUTO-GENERATED from SKILL.md.tmpl - do not edit directly -->

# Grill

Interview the user relentlessly about every aspect of a plan until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one.

## 入口条件

**何时触发**
- 用户 utterances: "grill me", "let's align", "challenge this plan", "does this make sense?"
- Plan 或 design 存在未解决的依赖、未定义术语或隐含假设。
- Issue 从 `triage` 移动到 `plan` 时没有书面的 `acceptance-contract`。
- 出现术语漂移：用户用多个不同名称描述同一概念。

**前置条件**
- 有 plan、design、issue 或概念需要澄清。

**Skill 边界（什么情况下应该加载别的 skill）**
- 用户要求 quick code snippet 或 one-line fix → 直接实现，不 grill
- 需求已完全明确，有 acceptance criteria，无歧义 → 不 grill，直接进入 plan/implement
- 用户明确说 "just do it" 或 "no need to discuss" → 不 grill
- 时间压力极大且错误成本低于讨论成本 → 不 grill
- 需要代码调试 → `/gxpm-debug-issue`
- 需要产出实现计划 → `/gxpm-planning`
- 需要 issue 分类 → `/gxpm-triage`

<what-to-do>

## 可操作流程

### 1. Ask one question at a time

Wait for feedback on each question before continuing. If a question can be answered by exploring the codebase, explore the codebase instead.

### 2. Challenge against the glossary

When the user uses a term that conflicts with the existing language in `CONTEXT.md`, call it out immediately:

> "Your glossary defines 'cancellation' as X, but you seem to mean Y — which is it?"

### 3. Sharpen fuzzy language

When the user uses vague or overloaded terms, propose a precise canonical term:

> "You're saying 'account' — do you mean the Customer or the User? Those are different things."

### 4. Discuss concrete scenarios

When domain relationships are being discussed, stress-test them with specific scenarios. Invent scenarios that probe edge cases and force the user to be precise about boundaries between concepts.

### 5. Cross-reference with code

When the user states how something works, check whether the code agrees. If you find a contradiction, surface it:

> "Your code cancels entire Orders, but you just said partial cancellation is possible — which is right?"

</what-to-do>

<supporting-info>

## Documentation side effects

As decisions crystallise, update project documentation inline. Do not batch these up — capture them as they happen.

### Update CONTEXT.md

When a term is resolved, update `CONTEXT.md` right there. Use this format:

```markdown
## Language

**Issue tracker**:
The tool that hosts a repo's issues — GitHub Issues, Linear, a local markdown convention, or similar.
_Avoid_: backlog manager, backlog backend, issue host

**Issue**:
A single tracked unit of work inside an **Issue tracker**.
_Avoid_: ticket

## Relationships

- An **Issue tracker** holds many **Issues**
- An **Issue** carries one **Triage role** at a time

## Flagged ambiguities

- "backlog" was previously used to mean both the *tool* and the *body of work* — resolved.
```

Create `CONTEXT.md` lazily — only when you have the first term to write. Do not couple it to implementation details; only include terms meaningful to domain experts.

### Offer ADRs sparingly

Only offer to create an ADR when all three are true:

1. **Hard to reverse** — the cost of changing your mind later is meaningful.
2. **Surprising without context** — a future reader will wonder "why did they do it this way?"
3. **The result of a real trade-off** — there were genuine alternatives and you picked one for specific reasons.

If any of the three is missing, skip the ADR. Write ADRs under `docs/adr/` using this format:

```markdown
# ADR-000N: Title

## Status

Accepted

## Context

What is the forcing function? What constraints exist?

## Decision

What are we doing?

## Consequences

What becomes easier? What becomes harder?
```

</supporting-info>

## 红旗清单 / 反模式

- **STOP：不要对 clear one-line fix 进行 grilling。** User says "Add a login button to the header." → 直接实现。Grill 仅当 login flow 涉及 CONTEXT.md 中没有的新领域概念。
- **STOP：不要对 fully specified、无歧义的需求 grilling。** 浪费用户时间。
- **STOP：不要跳过 grilling 直接 coding（当涉及新领域概念时）。** User says "Let's build a real-time sync system." → 必须先 grill：WebSockets, SSE, polling, CRDTs？哪种一致性模型？失败模式是什么？
- **STOP：不要 batch 文档更新。** 决策结晶时立即内联更新文档，不要攒到后面。
- **危险信号：**  grilling 过程中 issue 范围不断扩大 → 停止，要求用户先拆分 issue 再继续。
- **危险信号：** 同一概念出现多个名称而用户不认为它们是同义词 → 强制选择一个并写入 CONTEXT.md。

## 验证清单 / 出口条件

- [ ] 每个设计分支的依赖已逐层解决。
- [ ] 术语已统一并记录到 `CONTEXT.md`。
- [ ] `triage → plan` 阶段：`acceptance-contract` 已更新并书面化。
- [ ] `plan` 阶段：`implementation-plan` 已更新，关键实现决策已解决。
- [ ]  grilling 过程中创建的 ADR 已记录到 issue artifact history（通过 `gxpm artifact write`）。
- [ ] 用户和代理对 plan 达成 shared understanding。

**失败时路由**
-  grilling 后仍无法做架构决策 → `/gxpm-architecture`
-  issue 需要重新分类 → `/gxpm-triage`
-  需要进一步代码调研 → `/gxpm-explore-codebase`

## 常见说辞表

| 用户 utterance | 推荐回应 |
|----------------|----------|
| "grill me" / "challenge this plan" | "好。我们从最不确定的假设开始。请确认 [关键假设1] 是否成立？如果变化，会影响哪些决策？" |
| "let's align" | "我先梳理当前计划中未解决的依赖项和未定义术语，然后逐一确认。" |
| "does this make sense?" | "我先检查计划与领域模型的一致性，然后指出冲突或缺失的约束。" |
| "Add a login button to the header."（清晰请求） | "这个请求很清晰，直接实现。如果 login flow 涉及新领域概念，我再 grill。" |
| "Let's build a real-time sync system."（模糊宏大） | "'Real-time' 涵盖 WebSockets、SSE、polling、CRDTs。我们先对齐：选哪种？一致性模型？失败模式？" |

## gxpm integration

- Before leaving `triage`, use grilling to clarify issue scope and write the `acceptance-contract`.
- During `plan`, use grilling to resolve implementation decisions and write the `implementation-plan`.
- Record any ADR created during grilling in the issue's artifact history via `gxpm artifact write`.
