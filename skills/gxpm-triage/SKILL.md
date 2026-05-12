---
name: gxpm-triage
description: Triage issues through a state machine of triage roles. Use when user wants to create an issue, review incoming bugs or feature requests, prepare issues for an AFK agent, or manage issue workflow.
---

# Triage

Move issues through a small state machine of triage roles.

## 入口条件

**何时触发**
- 用户想创建 issue。
- 用户要求 review incoming bugs 或 feature requests。
- 用户需要 prepare issues for an AFK agent。
- 用户需要 manage issue workflow（查看待分类、待处理的内容）。
- 从 `plan` 回退或新信息到达时，需要重新评估 issue 状态。

**前置条件**
- Issue body 或 bug report 已存在；或用户已提供足够信息创建新 issue。

**Skill 边界（什么情况下应该加载别的 skill）**
- 需求/范围需要深入对齐 → `/gxpm-grill`
- 需要代码调试定位根因 → `/gxpm-debug-issue`
- 需要产出实现计划或 PRD → `/gxpm-planning`
- 需要自动驾驶全流程 → `/gxpm-autopilot`

## 可操作流程

### 角色定义

Two **category** roles:
- `bug` — something is broken
- `enhancement` — new feature or improvement

Five **state** roles:
- `needs-triage` — maintainer needs to evaluate
- `needs-info` — waiting on reporter for more information
- `ready-for-agent` — fully specified, ready for an AFK agent
- `ready-for-human` — needs human implementation
- `wontfix` — will not be actioned

Every triaged issue should carry exactly one category role and one state role.

### 1. Show what needs attention

Query the issue tracker and present three buckets, oldest first:

1. **Unlabeled** — never triaged.
2. **`needs-triage`** — evaluation in progress.
3. **`needs-info` with reporter activity since last triage notes** — needs re-evaluation.

Show counts and a one-line summary per issue.

### 2. Triage a specific issue

1. **Gather context.** Read the full issue (body, comments, labels, reporter, dates). Parse prior triage notes. Explore the codebase. Read `.gxpm/out-of-scope/` (if exists) and surface any prior rejection that resembles this issue.

2. **Recommend.** Tell the maintainer your category and state recommendation with reasoning, plus a brief codebase summary.

3. **Reproduce (bugs only).** Before grilling, attempt reproduction. Report what happened — successful repro, failed repro, or insufficient detail (a strong `needs-info` signal).

4. **Grill (if needed).** If the issue needs fleshing out, run `/gxpm-grill`.

5. **Apply the outcome:**
   - **No exceptions:** category + state must both be assigned. Never leave an issue with only one dimension filled.
   - `ready-for-agent` — write an agent brief.
   - `ready-for-human` — same structure as agent brief, but note why it can't be delegated.
   - `needs-info` — post triage notes.
   - `wontfix` (bug) — polite explanation, then close.
   - `wontfix` (enhancement) — write to `.gxpm/out-of-scope/`, link from comment, then close.

#### Agent brief format

```markdown
## What to build
Concise description.

## Acceptance criteria
- [ ] Criterion 1
- [ ] Criterion 2

## Key constraints
- Constraint 1
- Constraint 2

## Relevant code areas
- File/path 1
- File/path 2
```

#### Needs-info template

```markdown
## Triage Notes

**What we've established so far:**
- point 1
- point 2

**What we still need from you (@reporter):**
- question 1
- question 2
```

### gxpm integration

- gxpm's `triage` phase initializes the `acceptance-contract` artifact.
- During triage, if the issue is a bug, the `acceptance-contract` must include a `reproduction` field:
  - Test command that reproduces the bug, OR
  - Steps to reproduce, OR
  - "Could not reproduce — insufficient detail"
- The `acceptance-contract` should include a `triageRole` field:
  - `needs-info` / `ready-for-agent` / `ready-for-human` / `wontfix`
- Use `gxpm issue create --auto-id` for new issues; use `gxpm issue transition` to move through phases.
- Out-of-scope knowledge lives under `.gxpm/out-of-scope/<topic>.md`.

## 红旗清单 / 反模式

- **STOP：没有 reproduction，就没有 `ready-for-agent`。** A bug without a reproduction attempt or clear "could not reproduce — insufficient detail" note must NOT be marked `ready-for-agent`.
- **STOP：范围蔓延。** If the issue grows beyond its original description during triage, stop and ask the user to split it before assigning a state role.
- **STOP：冲突的 triage roles。** If an issue carries more than one category role or more than one state role, reset to `needs-triage` and fix immediately.
- **STOP：绕过 `needs-info`。** Never guess a category or state when information is insufficient. Default to `needs-info`.
- **STOP：绝不只分配一个维度。** category + state 必须同时分配；禁止只填其一。
- **危险信号：** "The bug is obvious, no need to reproduce." → Obvious bugs are the most dangerous to skip. Reproduction validates assumptions and provides the acceptance-contract entry.
- **危险信号：** "The reporter is trusted, mark it ready-for-agent." → **No exceptions.** Every bug needs reproduction or a clear `needs-info` path, regardless of who reported it.
- **危险信号：** "I'll just add both category roles to be safe." → Exactly one category role. Adding both destroys the state machine and makes routing impossible.
- **危险信号：** "The user seems impatient, I'll skip grilling." → Skipping grilling when scope is unclear produces `ready-for-agent` issues that fail at `ac-check`.

**Foundational Principle:** Violating the letter of the rules is violating the spirit of the rules. The triage state machine exists to protect downstream phases from garbage-in-garbage-out. Every shortcut at triage becomes a blocker at `implement`, `local-verify`, or `land`. Discipline here is kindness to the future agent.

## 验证清单 / 出口条件

- [ ] 每个 issue 恰好一个 category role 和一个 state role。
- [ ] Bug 必须有 reproduction（test command / steps / "Could not reproduce — insufficient detail"）。
- [ ] `acceptance-contract` artifact 已初始化，含 `triageRole` 字段。
- [ ] `ready-for-agent` 已输出 agent brief（What to build / Acceptance criteria / Key constraints / Relevant code areas）。
- [ ] `ready-for-human` 已说明为什么不能委托给 agent。
- [ ] `needs-info` 已输出 triage notes（已建立的事实 + 仍需 reporter 提供的信息）。
- [ ] `wontfix` (bug) 已有 polite explanation 并关闭。
- [ ] `wontfix` (enhancement) 已写入 `.gxpm/out-of-scope/` 并关闭。

**失败时路由**
- Scope 不清或术语漂移 → `/gxpm-grill`
- 需要代码定位或根因分析 → `/gxpm-debug-issue`
- 已 ready-for-agent 需要实现计划 → `/gxpm-planning`

## 常见说辞表

| 用户 utterance / 借口 | 推荐回应 |
|-----------------------|----------|
| "这个 bug 很明显，不用复现。" | "明显的 bug 跳过复现最危险。复现能验证假设，也是验收契约的入口。请先尝试复现。" |
| "报告者很可信，直接 ready-for-agent 吧。" | "没有例外。每个 bug 都需要复现或清晰的 needs-info 路径，无论谁报告的。" |
| "我把两个 category 都加上以防万一。" | "只能选一个 category role。选两个会破坏状态机，导致路由失败。请根据问题本质选一个。" |
| "用户好像很急，我就不 grill 了。" | "scope 不清时跳过 grilling，会导致 ready-for-agent 的 issue 在 ac-check 阶段失败。建议先用 /gxpm-grill 对齐。" |
| "帮我看看有哪些 issue 需要处理。" | 展示 Unlabeled / needs-triage / needs-info with reporter activity 三个 bucket。 |
