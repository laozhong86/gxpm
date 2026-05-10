# Layered Workflow Boundaries

日期：2026-05-10

## 目的

本文件把 `ZeroZ-lab/unified-skills` 的完整工程实践，转译为 gxpm 的长期分层合同。

它回答五个边界问题：

- Command 负责什么？
- Agent 负责什么？
- Skill 负责什么？
- Artifact 负责什么？
- Hook / Validate 负责什么？

gxpm 的目标不是复制 unified-skills 的目录，而是吸收它的分层原则：入口清晰、职责单一、证据可追溯、运行前后都有守卫。

## 上游研究证据

研究对象：

- 本地路径：`/Users/x/Desktop/Project/github/unified-skills`
- 上游仓库：`https://github.com/ZeroZ-lab/unified-skills`
- 研究时 HEAD：`f4e6dde`

关键工程实践：

- `CANON.md` 定义不可破坏的系统规则，约束 command、agent、skill、hook 的协作方式。
- `commands/*.md` 把用户意图收敛为可执行流程，例如 `refine`、`plan`、`build`、`review`、`ship`。
- `agents/*.md` 把执行者拆成明确责任视角，例如 spec compliance auditor、code quality auditor、task planner、software engineer。
- `skills-index.json` 和 `load-manifest.json` 把 skill 变成可发现、可加载、可校验的能力目录。
- `hooks/*.sh` 与 `hooks/hooks.json` 在 SessionStart、UserPromptSubmit、工具使用前后注入运行守卫。
- `validate` 把目录、索引、manifest、hook 和命名约定变成可重复执行的检查。

这套实践的核心不是文件格式，而是分层闭环：

```text
Command 选择流程
Agent 承担责任视角
Skill 提供可加载方法
Artifact 保存事实和证据
Hook / Validate 阻止边界漂移
```

## gxpm 分层定义

### Command

Command 是用户和 agent 进入 state graph 的入口。

在 gxpm 中，Command 由 CLI 和 phase gate 表达：

- `scripts/gxpm.ts`
- `scripts/phase-artifact-commands.ts`
- `core/phase-gates.ts`

Command 只回答：

- 当前 phase 允许什么动作？
- 需要哪个输入 artifact？
- 会生成哪个输出 artifact？
- 是否可以 transition？

Command 不应该承载长期业务真值。业务真值必须写入 `.gxpm/issues/<id>/`。

### Agent

Agent 是责任视角，不是人格模板。

在 gxpm 中，Agent 当前主要体现在 phase 责任里：

- triage owner 澄清范围和验收合同。
- planner owner 输出实现计划和验证策略。
- implementer owner 修改代码并记录 local verification。
- reviewer owner 检查 acceptance、self-review、ship readiness。
- QA owner 记录 browser/runtime 证据。
- land owner 记录 merge plan 和 release risks。

GXPM-120 的研究结论是：Agent 层还没有成为第一类 registry。短期先通过 capability contract 覆盖每个 phase gate，长期再设计 Agent Runtime，把 role、input、output、stop rule 和 handoff 做成可查询契约。

### Skill

Skill 是 host 发现和加载 gxpm 方法的表面，不是真值层。

在 gxpm 中，Skill Surface 包括：

- `skills/gxpm/SKILL.md.tmpl`
- `scripts/gen-skill-docs.ts`
- 生成后的 host-facing `SKILL.md`
- host config 和 skill naming checks

Skill 可以解释如何运行 gxpm，但不能替代：

- state graph
- artifact store
- capability registry
- phase gate rules

因此修改 skill 时必须改模板和生成器，不把生成物当真值手修。

### Artifact

Artifact 是 phase 结论、验收状态和可恢复事实。

在 gxpm 中，Artifact 的位置是：

```text
.gxpm/issues/<issue-id>/artifacts/*.json
```

Artifact 必须承载：

- 当前 phase 的输入摘要
- 输出结论
- 验收状态
- 风险和失败模式
- 后续 phase 可恢复的最小事实

原始证据不应该塞进 artifact。截图、console、命令输出、review 原文和调查过程属于 `evidence/`，artifact 只引用它们并总结结论。

### Hook / Validate

Hook 和 Validate 是防漂移层。

在 gxpm 中，对应能力包括：

- git hooks 和 `gxpm gate`
- `bun run check`
- `scripts/scaffold-check.ts`
- `scripts/governance-check.ts`
- `core/artifact-validator.ts`
- phase gate tests

Hook / Validate 不应该替 agent 做业务判断；它们只负责阻止明显违反合同的状态进入仓库。

## 四个缺口

### 1. Agent 层不是第一类对象

问题：gxpm 有 phase 和 capability，但没有像 unified-skills `agents/*.md` 那样可查询的责任视角目录。

本次落地：先把每个 phase gate artifact 映射到 capability contract，确保执行责任至少有清楚的输入、输出、证据、失败模式和 mutation policy。

后续方向：新增 Agent Runtime 或 agent registry，把 reviewer、QA、implementer、planner 等责任视角显式建模。

### 2. Capability Registry 没覆盖所有 phase gate artifact

问题：部分 gate artifact 只存在于 phase initializer 和 tests 中，没有 capability contract。这样 agent 不知道某个 artifact 对应的能力边界。

本次落地：`core/capabilities.ts` 补齐 gate artifact 覆盖，并用测试证明所有 `PHASE_GATE_RULES.requiredArtifact` 都能被 capability 输出。

### 3. Artifact Validator 仍停留在旧 artifact 名称

问题：validator 还在校验早期 `spec`、`plan`、`tasks`，而 gxpm 当前 artifact 已经演化为 `acceptance-contract`、`implementation-plan`、`dispatch-handoff` 等。

本次落地：`core/artifact-validator.ts` 改为基于 `ARTIFACT_TYPES` 的 gxpm artifact schema，并让 CLI artifact write 使用统一 validator。

### 4. Validate 层没有检查分层边界漂移

问题：`bun run check` 主要验证 host config、governance、version、skill naming，不能发现 phase gate、capability output、artifact validator 三者不一致。

本次落地：`scripts/scaffold-check.ts` 增加 layered workflow contract check，检查：

- 每个 phase gate artifact 都有 capability output。
- 每个 artifact type 都被 artifact validator 覆盖。
- capability output 不引用未知 artifact。

## 边界矩阵

| Layer | gxpm 真值 | 允许写入 | 不允许承担 |
| --- | --- | --- | --- |
| Command | `core/phase-gates.ts`、CLI command handlers | phase transition、artifact initialization | 长期业务事实 |
| Agent | phase owner / future agent registry | handoff、review、QA、land 责任结论 | 绕过 phase gate |
| Skill | `*.tmpl`、生成器、host config | host-facing guidance | state truth、artifact truth |
| Artifact | `.gxpm/issues/<id>/artifacts/*.json` | phase 结论、验收状态、风险 | 原始日志和截图 |
| Hook / Validate | `gxpm gate`、`bun run check`、scaffold checks | 阻止合同漂移 | 替代人工判断或业务验收 |

## 非目标

- 不引入 unified-skills 运行时依赖。
- 不把 gxpm 写成 unified-skills、PMC 或 gstack 的兼容壳。
- 不在本次实现完整 Agent Runtime。
- 不把所有 evidence schema 一次性收紧；本次只校准 phase gate artifact 的结构边界。

## 设计原则

1. Command 只路由，不沉淀事实。
2. Agent 是责任，不是聊天人格。
3. Skill 是入口，不是真值。
4. Artifact 是恢复和验收的最小事实。
5. Hook / Validate 是防漂移，不替代判断。
6. 每个 capability 必须声明输入、输出、证据、失败模式和 mutation policy。
