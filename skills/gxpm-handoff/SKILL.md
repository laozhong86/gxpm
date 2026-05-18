---
name: gxpm-handoff
description: Compact the current session into a handoff document so another agent can continue the work. Use when switching agents, ending a session, or passing work between implementer subagents.
---

# Handoff

Write a handoff document summarising the current session so a fresh agent can continue the work without losing context.

## 入口条件

**何时触发**
- 当前 session 即将结束，需要让下一个 session 接续工作。
- dispatch 阶段需要将一个 implementer subagent 的工作传递给下一个 subagent。
- 用户明确说 "handoff"、"summarise for next session"、"pass this to another agent"。
- 一个 phase 完成，进入下一个 phase 且 agent 上下文可能重置时。

**Skill 边界（什么情况下应该加载别的 skill）**
- 需要代码调试 → `/gxpm-diagnose`
- 需要对齐需求 → `/gxpm-grill`
- 需要运行验证流水线 → `/gxpm-verify`
- 需要提交代码 → `/gxpm-hygiene`

## 可操作流程

### 1. Gather context

Collect the essential state from the current session:

- **Current phase** — what gxpm phase is the issue in?
- **What was done** — files changed, tests written, decisions made
- **What was NOT done** — explicit scope exclusions or deferred items
- **Blockers** — anything that stopped progress or needs resolution
- **Next steps** — what the next agent should do first
- **Relevant artifacts** — paths to PRDs, plans, ADRs, test outputs, screenshots

### 2. Write the handoff doc

Save to a temporary path:

```bash
mktemp -t handoff-XXXXXX.md
```

Or append to the issue's artifact history:

```bash
gxpm artifact write <issue-id> handoff --stdin
```

### 3. Structure

```markdown
# Handoff: <issue-id> — <brief description>

## Session summary
- Host: <Claude/Codex/etc>
- Date: <ISO date>
- Phase: <current gxpm phase>

## What was done
- <item 1>
- <item 2>

## What remains
- <item 1>
- <item 2>

## Blockers / concerns
- <item 1>

## Next steps (prioritised)
1. <first thing the next agent should do>
2. <second thing>

## Key artifacts
- Plan: <path or URL>
- Spec: <path or URL>
- Test results: <path or summary>
- Screenshots / evidence: <paths>

## Skills to load next
- <e.g. /gxpm-tdd for remaining implementation>
- <e.g. /gxpm-verify for running tests>
```

### 4. Do not duplicate

Do not duplicate content already captured in other artifacts (PRDs, plans, ADRs, issues, commits, diffs). Reference them by path or URL instead.

## 红旗清单 / 反模式

- **STOP：不要复制粘贴整段代码。** 引用文件路径，不要内联代码块。
- **STOP：不要遗漏阻塞物。** 如果工作被阻塞，必须明确说明阻塞原因和已尝试的解决方案。
- **STOP：不要假设下一个 agent 知道上下文。** 即使是显而易见的状态，也要明确写出。
- **危险信号：** Handoff 文档超过 200 行 → 过度详细，应拆分为 artifact 引用。
- **危险信号：** 没有 "Next steps" 部分 → 下一个 agent 不知道从何开始。

## 验证清单 / 出口条件

- [ ] 当前 phase 和 issue 状态已明确记录。
- [ ] 已完成工作和剩余工作已区分。
- [ ] 任何阻塞物已记录，包括已尝试的解决方案。
- [ ] 下一步已按优先级列出。
- [ ] 已有 artifact 被引用而非复制。
- [ ] 建议了下一个 agent 应加载的 skills。
- [ ] 文档已保存到临时路径或 issue artifact。

**失败时路由**
- 阻塞物需要调试 → `/gxpm-diagnose`
- 阻塞物是需求不清 → `/gxpm-grill`
- 需要验证当前工作 → `/gxpm-verify`
