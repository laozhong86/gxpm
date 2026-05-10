# gxpm Replacement Architecture

日期：2026-04-24

## 目标

gxpm 是替代 PMC 和 gstack 的二代产品。它要把两个项目中已经验证有效的能力重新组织成一个统一系统，而不是在运行时继续依赖两套 skill。

一句话架构：

```text
gxpm = State Graph + Capability Runtime + Evidence Store + Policy Engine + Skill Surface
```

## 为什么不能只是集成层

PMC 和 gstack 的边界来自各自历史：

- PMC 从 Linear issue delivery 出发，强在 phase gate 和 artifact truth，但缺少完整工程工作流 runtime。
- gstack 从 agent software factory 出发，强在 browser/review/QA/ship/learn，但缺少 Linear-first PM 状态机。

如果 gxpm 只是把 PMC 放核心、把 gstack 放外围，会留下两个长期问题：

- 状态分裂：`.omc/pm`、`.gstack/projects`、PR body、chat memory 各自为政。
- 能力分裂：PM gate、browser QA、review、ship、learn 由不同 skill 定义，难以统一恢复和审计。

gxpm 的二代价值就是消除这两个分裂。

## 产品模块

### 1. State Graph

State Graph 是 gxpm 的主干，替代 PMC phase state 和 gstack timeline 的分离模式。

职责：

- issue lifecycle
- phase transition
- dependency graph
- blocking gates
- resume state
- compensation state

核心原则：

- 本地 state 永远比 Linear comment、PR body、聊天上下文更权威。
- phase JSON artifact 比 markdown report 更权威。
- 所有 transition 都必须可审计、可重放、可恢复。

### 2. Capability Runtime

Capability Runtime 替代 gstack 的分散 skill tree 和 PMC 的 provider binding。

V0 capability：

- `issue`: Linear/GitHub issue intake、sync、writeback。
- `planning`: triage、scope、acceptance contract、risk profile。
- `execution`: worktree、dispatch、worker handoff、claim/release。
- `verification`: local verify、AC check、independent verify。
- `review`: diff review、specialist review、adversarial review。
- `browser`: persistent browser、QA evidence、console/network/screenshot。
- `release`: ship、PR body、pr-check、land handoff。
- `memory`: context restore、timeline、learn、retro。
- `skill`: discovery、routing、preamble、template generation。

每个 capability 必须有：

- input schema
- output artifact schema
- mutation policy
- idempotency rule
- failure mode
- evidence requirements

### 3. Evidence Store

Evidence Store 把 PMC 的 phase artifacts 与 gstack 的 QA/review/browser evidence 合并成统一证据层。

建议目录：

```text
.gxpm/issues/<issue-id>/
  state.json
  graph.json
  artifacts/
    acceptance-contract.json
    local-verify.json
    ac-check.json
    verify-findings.json
    qa-findings.json
    release-findings.json
  reports/
    triage.md
    dispatch.md
    verify.md
    qa.md
    land.md
  evidence/
    screenshots/
    console.jsonl
    network.jsonl
    commands.jsonl
    commits.jsonl
  memory/
    resume-packet.json
    execution-log.md
    execution-memory.md
```

### 4. Policy Engine

Policy Engine 替代 PMC 的分散 gate rules 和 gstack 各 skill 内部的 stop rules。

它回答：

- 当前 phase 能不能进入下一 phase？
- 哪些 acceptance criterion 需要 browser evidence？
- 哪些 diff 需要 specialist review？
- 哪些操作是 irreversible，必须用户确认？
- GitHub/CI/CodeRabbit/Linear 失败是阻塞还是噪声？
- 当前验证强度是 fast、standard、high-risk 还是 regression？

### 5. Skill Surface

Skill Surface 是代理入口，不是业务真值。

它提供：

- `/gxpm triage`
- `/gxpm plan`
- `/gxpm dispatch`
- `/gxpm verify`
- `/gxpm qa`
- `/gxpm land`
- `/gxpm ship`
- `/gxpm investigate`
- `/gxpm review`
- `/gxpm learn`

底层都调用同一套 state graph 和 capability runtime。

### 6. Layered Workflow Boundaries

gxpm 的 Command / Agent / Skill / Artifact / Hook 边界以
`docs/architecture/layered-workflow-boundaries.md` 为准。

核心约束：

- Command 只负责路由 phase、初始化 artifact 和触发 transition。
- Agent 是责任视角，不是 persona；它必须通过 capability contract 暴露输入、输出、证据、失败模式和 mutation policy。
- Skill 是 host-facing 入口，不替代 state graph、artifact store 或 capability registry。
- Artifact 保存 phase 结论和可恢复事实；原始日志、截图和调查过程进入 evidence store。
- Hook / Validate 只负责防漂移，不替代验收判断。

## PMC 能力替代表

| PMC 能力 | gxpm 原生模块 | 替代方式 |
| --- | --- | --- |
| `.omc/pm/<issue>/state.json` | State Graph | import/migrate 后由 `.gxpm/issues/<id>/state.json` 接管 |
| phase guides | Capability guides | 保留 gate 意图，重写为 capability input/output |
| checkpoint.py | State transition API | transition 写 state、artifact index、event log |
| Linear sync | Issue Runtime | Linear 是 provider，不是真值 |
| acceptance/local-verify/verify/qa contracts | Evidence Store | schema 归一，reports 变成渲染视图 |
| execution continuity | Memory Runtime | resume packet、execution memory、timeline 统一 |
| land gate | Release Runtime | land 是 policy gate，merge/deploy 可委托但必须写回 gxpm |

## gstack 能力替代表

| gstack 能力 | gxpm 原生模块 | 替代方式 |
| --- | --- | --- |
| preamble | Skill Runtime | 版本、配置、会话、learn、routing 变成统一 preflight |
| browse daemon | Browser Runtime | 重用设计原则，重写 state/evidence 接口 |
| `/qa` | Browser + Verification Runtime | Test -> Fix -> Verify 写入 issue evidence |
| `/review` | Review Runtime | specialist/adversarial review 归入 release gates |
| `/ship` | Release Runtime | ship 自动化受 gxpm policy 控制 |
| `/investigate` | Verification Runtime | root cause trail 写入 issue DEBUG/evidence |
| learn/timeline | Memory Runtime | 项目记忆与 issue 恢复合并 |
| template-generated SKILL.md | Skill Runtime | gxpm 自己生成 skill docs，防漂移 |
| team init/host abstraction | Install Runtime | Codex/Claude/OpenClaw 作为 host，不作为架构边界 |

## V0 最小替代闭环

V0 不需要一次性替代所有 gstack skills，但必须证明 gxpm 的产品骨架成立。

最小闭环：

1. 从 Linear 或本地创建 issue。
2. 生成 gxpm state graph。
3. triage 产出 acceptance contract。
4. dispatch 产出 worker handoff。
5. local verify 写入 evidence。
6. review/qa 至少有一个 capability 可运行并写回。
7. land gate 给出可执行结论，但不可逆动作仍需用户确认。
8. 新会话只靠 `.gxpm/issues/<id>` 恢复。

## 架构判断

推荐路线：先做 unified core，再迁移能力。

原因：

- 先接 gstack browser 或 PMC phase 都会把 gxpm 带回旧边界。
- unified core 先定义 state/evidence/policy，后续所有能力都只能接到同一套接口上。
- 这会稍慢一点，但能避免二代项目一开始就背上两套历史债。

## 风险

- 范围过大：用 V0 最小闭环限制，不一次性替代所有 skill。
- 迁移成本高：保留 import/migrate，而不是运行时兼容两套目录。
- browser runtime 复杂：先定义 browser evidence contract，再决定复用还是重写 daemon。
- release 自动化风险高：ship/land 默认 gate-first，所有不可逆操作需要显式确认。
