---
name: gxpm-zoom-out
type: technique
description: Tell the agent to zoom out and give broader context or a higher-level perspective. Use when you're unfamiliar with a section of code, stuck in implementation details, or need to understand how code fits into the bigger picture.
---

**Announce at start:** "I am using the gxpm-zoom-out skill to zoom out from local implementation details and give a higher-level perspective on how the current code fits in the bigger picture."

# Zoom Out

Go up a layer of abstraction. Stop drowning in details and see the map.

## When to trigger（入口条件）

**何时触发**
- 你在 implement 阶段陷入了实现细节，不确定当前修改是否符合架构设计。
- 你面对一段不熟悉的代码，需要理解它如何融入更大的系统。
- 用户说 "zoom out"、"bigger picture"、"how does this fit?"、"step back"。
- 你连续阅读了多个文件但仍无法理解系统的组织方式。
- 你在调试时迷失在调用链中，需要模块级别的地图。

**Skill 边界（什么情况下应该加载别的 skill）**
- 需要具体代码调试定位根因 → `/gxpm-debug-issue`
- 需要深度理解特定模块内部 → `/gxpm-explore-codebase`
- 需要架构改进建议 → `/gxpm-architecture`
- 需要术语对齐或计划验证 → `/gxpm-grill`

## 可操作流程

### 1. Ask for the map

Request a high-level overview using the project's domain glossary vocabulary:

> "Give me a map of all the relevant modules and callers. Use the domain glossary from CONTEXT.md."

### 2. What to surface

Provide a concise architectural briefing covering:

- **Modules involved** — name and one-line responsibility for each relevant module
- **Call graph** — who calls whom, data flow direction
- **Domain concepts** — which CONTEXT.md terms are active in this area
- **ADR relevance** — any architectural decisions that govern this code path
- **Integration seams** — where this code meets external systems or other bounded contexts

### 3. What NOT to do

- Do not dump file listings or raw directory trees.
- Do not read every file in the module — summarize from what you already know.
- Do not descend into function-level detail unless specifically asked.
- Do not suggest code changes — this is a viewing skill, not an editing skill.

## Red Flags（红旗清单 / 反模式）

- **STOP：不要变成文件浏览器。** Zoom-out 的目标是理解关系，不是枚举文件。
- **STOP：不要建议重构。** 如果发现了架构问题，交给 `/gxpm-architecture`。
- **STOP：不要在 zoom-out 后继续深挖。** 如果用户说 "zoom out"，不要立刻开始读下一个文件的每一行。
- **危险信号：** 输出变成了目录列表 → 重新组织为模块关系图。
- **危险信号：** 使用了与 CONTEXT.md 不一致的术语 → 纠正并引用 glossary。

## Verification（验证清单 / 出口条件）

- [ ] 提供了模块地图（不是文件列表）。
- [ ] 使用了 CONTEXT.md 中的领域术语。
- [ ] 说明了相关 ADR（如果有）。
- [ ] 没有建议具体代码修改。
- [ ] 用户能够基于这个地图做出下一步决策（继续实现、深入调试、或架构调整）。

**失败时路由**
- 需要具体代码调试 → `/gxpm-debug-issue`
- 需要架构改进建议 → `/gxpm-architecture`
- 需要术语对齐 → `/gxpm-grill`

## Read Next

- `/gxpm-explore-codebase` — graph-driven exploration
- `/gxpm-architecture` — find structural opportunities
