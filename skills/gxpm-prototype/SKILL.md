---
name: gxpm-prototype
description: Build a throwaway prototype to validate a design before committing to it. Use when you need to sanity-check a data model, state machine, or UI design before writing behavior-spec.
---

# Prototype

A prototype is **throwaway code that answers a question**. The question decides the shape.

## 入口条件

**何时触发**
- 用户说 "prototype this"、"let me play with it"、"try a few designs"。
- 在 `specify` 阶段之前，需要快速验证数据模型或状态机设计。
- 不确定 UI 方向，想先探索几种 radically different 的变体。
- 业务逻辑分支复杂，难以在纸上推理清楚。

**Skill 边界（什么情况下应该加载别的 skill）**
- 需求/范围尚未澄清 → `/gxpm-grill`
- 需要正式的 BDD 行为规约 → `/gxpm-specifier`
- 需要架构层面的模块设计 → `/gxpm-architecture`
- 已经确认设计，需要实现 → `/gxpm-tdd`

## 可操作流程

### Pick a branch

Identify which question is being answered:

- **"Does this logic / state model feel right?"** → Logic prototype. Build a tiny interactive terminal app that pushes the state machine through cases hard to reason about on paper.
- **"What should this look like?"** → UI prototype. Generate several radically different UI variations on a single route, switchable via a URL search param and a floating bottom bar.

The two branches produce very different artifacts — getting this wrong wastes the whole prototype. If the question is genuinely ambiguous and the user isn't reachable, default to whichever branch better matches the surrounding code (backend module → logic; page or component → UI) and state the assumption at the top of the prototype.

### Rules that apply to both

1. **Throwaway from day one, and clearly marked as such.** Locate the prototype code close to where it will actually be used so context is obvious — but name it so a casual reader can see it's a prototype, not production.
2. **One command to run.** Whatever the project's existing task runner supports — `pnpm <name>`, `python <path>`, `bun <path>`, etc. The user must be able to start it without thinking.
3. **No persistence by default.** State lives in memory. Persistence is the thing the prototype is _checking_, not something it should depend on.
4. **Skip the polish.** No tests, no error handling beyond what makes the prototype _runnable_, no abstractions. The point is to learn something fast and then delete it.
5. **Surface the state.** After every action (logic) or on every variant switch (UI), print or render the full relevant state so the user can see what changed.
6. **Delete or absorb when done.** When the prototype has answered its question, either delete it or fold the validated decision into the real code — don't leave it rotting in the repo.

## 红旗清单 / 反模式

- **STOP：不要把原型当作生产代码。** 没有测试、没有错误处理、没有抽象 — 这些是故意的，不是 TODO。
- **STOP：不要在原型中追求完美。** 30 分钟能回答的问题不要花 3 小时。
- **STOP：不要把原型留在仓库里腐烂。** 回答完问题后要么删除，要么把验证过的决策吸收进正式代码。
- **STOP：不要为原型写 behavior-spec。** 原型在 specify 之前，不需要 BDD 规约。
- **危险信号：** 原型代码被 copy-paste 到正式实现 → 这是有意外的技术债务，应重新实现。
- **危险信号：** 原型运行需要复杂的 setup → 简化它，否则学习成本太高。

## 验证清单 / 出口条件

- [ ] 回答了预先定义的 question（logic feel right? or what should it look like?）。
- [ ] 代码明确标记为 PROTOTYPE / throwaway。
- [ ] 用户（或代理自己）能够运行并观察状态变化。
- [ ] 决策已记录（commit message、ADR、issue comment、或 NOTES.md）。
- [ ] 原型已删除，或关键决策已吸收进正式代码。

**失败时路由**
- 原型验证后需求仍不清晰 → `/gxpm-grill`
- 原型验证后需要正式规约 → `/gxpm-specifier`
- 原型暴露架构问题 → `/gxpm-architecture`
