# gxpm V0 合同

## 北极星

gxpm 是替代 PMC 和 gstack 的二代代理项目管理控制面。它把 Linear issue、阶段状态、执行代理、验证证据、浏览器 QA、评审、发布收口、上下文恢复和自学习整合到同一个原生系统里。

## 非目标

- 不做 PMC/gstack 的薄封装。
- 不保留“PMC 管项目、gstack 管工程流”的长期双轨。
- 不把历史 skill 目录直接 vendoring 成 gxpm。
- 不在 V0 一次性实现全部替代能力；V0 要形成最小可运行替代闭环。

## 核心对象

### Project

一个 gxpm 管理的代码项目或产品项目。Project 需要声明：

- issue provider：默认 Linear。
- state root：默认 `.gxpm/issues/<issue-id>/`。
- artifact root：默认同 state root。
- capability bindings：不同阶段调用哪些 gxpm 原生能力。

### Issue

Issue 是状态机实例。Issue 的本地真值必须在文件系统中存在，Linear 只是前门和同步面。

V0 已实现的本地目录：

```text
.gxpm/issues/<issue-id>/
  state.json
  graph.json
  events.jsonl
  artifacts/
    index.json
    acceptance-check.json
    acceptance-contract.json
    dispatch-handoff.json
    implementation-plan.json
    issue-intake.json
    local-verify.json
    pr-check.json
    qa-findings.json
    self-review.json
    ship-readiness.json
    triage-report.json
    verify-findings.json
  reports/
  evidence/
    screenshots/
  memory/
```

V0 已支持 JSON artifact store。当前 artifact type：

- `issue-intake`
- `triage-report`
- `acceptance-check`
- `acceptance-contract`
- `implementation-plan`
- `dispatch-handoff`
- `local-verify`
- `pr-check`
- `qa-findings`
- `self-review`
- `ship-readiness`
- `verify-findings`

V0 只写 JSON artifact，不渲染 markdown report。

### Phase

V0 phase 集合：

- `triage`
- `plan`
- `dispatch`
- `implement`
- `local-verify`
- `ac-check`
- `self-review`
- `ship`
- `pr-check`
- `verify`
- `qa`
- `land`

V0 可以导入 PMC/gstack 的语义，但最终 phase 是 gxpm 原生状态，不以 `.omc` 或 `.gstack` 作为长期真值。

V0 phase transition 采用严格顺序：只能从当前 phase 进入列表中的下一个 phase。

`triage -> plan` 额外要求存在 `acceptance-contract` artifact。缺失时 transition 必须失败，并提示先运行 `gxpm triage init <issue-id>`。

`plan -> dispatch` 额外要求存在 `implementation-plan` artifact。缺失时 transition 必须失败，并提示先运行 `gxpm plan init <issue-id>`。

`dispatch -> implement` 额外要求存在 `dispatch-handoff` artifact。缺失时 transition 必须失败，并提示先运行 `gxpm dispatch init <issue-id>`。

`implement -> local-verify` 额外要求存在 `local-verify` artifact。缺失时 transition 必须失败，并提示先运行 `gxpm implement verify <issue-id>`。

`local-verify -> ac-check` 额外要求存在 `acceptance-check` artifact。缺失时 transition 必须失败，并提示先运行 `gxpm local-verify ac-check <issue-id>`。

`ac-check -> self-review` 额外要求存在 `self-review` artifact。缺失时 transition 必须失败，并提示先运行 `gxpm ac-check self-review <issue-id>`。

`self-review -> ship` 额外要求存在 `ship-readiness` artifact。缺失时 transition 必须失败，并提示先运行 `gxpm self-review ship <issue-id>`。

`ship -> pr-check` 额外要求存在 `pr-check` artifact。缺失时 transition 必须失败，并提示先运行 `gxpm ship pr-check <issue-id>`。

`pr-check -> verify` 额外要求存在 `verify-findings` artifact。缺失时 transition 必须失败，并提示先运行 `gxpm pr-check verify <issue-id>`。

`verify -> qa` 额外要求存在 `qa-findings` artifact。缺失时 transition 必须失败，并提示先运行 `gxpm verify qa <issue-id>`。

## Source of Truth

真值优先级：

1. phase JSON artifacts
2. `state.json`
3. `resume-packet.json`
4. rendered markdown reports
5. Linear comments / PR body / chat history

任何恢复流程都必须先读本地 phase/state，而不是从聊天上下文猜。

## Ability Adapter

gxpm 用 capability runtime 统一所有能力。V0 可以先用 adapter 接入现有能力，但 adapter 是迁移脚手架，不是最终产品边界：

- `issueRuntime`：Linear read/write/sync 与 issue graph。
- `executionRuntime`：worker dispatch、worktree、task claim、local verification。
- `reviewRuntime`：代码评审、specialist review、adversarial review。
- `browserRuntime`：浏览器 QA、截图、console/network evidence。
- `releaseRuntime`：PR、版本、changelog、merge/deploy handoff。
- `memoryRuntime`：timeline、learn、context restore。
- `skillRuntime`：skill discovery、routing、preamble、模板生成。

每个 runtime/capability 必须声明：

- input contract
- output artifact
- failure mode
- idempotency rule
- 是否允许 mutation

## 与 PMC 的关系

PMC 是 gxpm 的上游能力来源和迁移对象，不是长期依赖。

gxpm 应吸收 PMC 的优秀部分：

- phase gating
- checkpoint
- Linear team key/source discipline
- acceptance/local-verify/verify/qa artifact contracts
- execution continuity

gxpm 应替换 PMC 的不足：

- QA 只停留在合同层。
- skill routing 与能力发现不够系统。
- 对 review/ship/design/devex/security/canary 的能力聚合不完整。

## 与 gstack 的关系

gstack 是 gxpm 的上游能力来源和迁移对象，不是长期依赖。

gxpm 应吸收 gstack 的优秀部分：

- preamble/config/session/timeline/learn 模式。
- template-generated skill docs。
- browser daemon 的设计原则。
- `/review`、`/qa`、`/investigate`、`/ship` 的证据和循环机制。
- team install 与 host abstraction 的思路。

gxpm 应替换 gstack 的不足：

- Claude-only 假设。
- 自动 ship/PR 的所有语义。
- 对项目目录写入 vendored gstack 的模式。

## V0 Stop Rules

V0 阶段如果出现以下情况，应停止并生成 report，而不是继续推进：

- 无法确定 issue/state 的真实阶段。
- Linear 与本地 state 冲突且无法安全补偿。
- adapter 的 mutation 行为不明确。
- QA/browser evidence 无法获得，但 acceptance 依赖浏览器行为。
- land/merge 需要不可逆操作但用户尚未确认。

## 成功信号

- 新会话可以只靠 `.gxpm/issues/<issue-id>/state.json` 和 artifacts 恢复。
- 每个 phase 都有明确的 required output。
- 每个能力都有 gxpm 原生 contract。
- 失败时能降级为本地报告，而不是把状态写坏。
- 一个 issue 可以在 gxpm 内完成从 intake 到 QA/land 的最小闭环，不必同时加载 PMC 和 gstack。

## V0 本地命令

```bash
gxpm issue create <issue-id>
gxpm issue status <issue-id>
gxpm issue transition <issue-id> <phase>
gxpm artifact list <issue-id>
gxpm artifact read <issue-id> <type>
gxpm triage init <issue-id>
gxpm plan init <issue-id>
gxpm dispatch init <issue-id>
gxpm implement verify <issue-id>
gxpm local-verify ac-check <issue-id>
gxpm ac-check self-review <issue-id>
gxpm self-review ship <issue-id>
gxpm ship pr-check <issue-id>
gxpm pr-check verify <issue-id>
gxpm verify qa <issue-id>
```

`gxpm issue create` 默认进入 `triage`。`gxpm issue transition` 不支持跳 phase 或 force。`gxpm triage init` 会生成 draft `acceptance-contract`，用于解锁 `triage -> plan`。`gxpm plan init` 会生成 draft `implementation-plan`，用于解锁 `plan -> dispatch`。`gxpm dispatch init` 会生成 draft `dispatch-handoff`，用于解锁 `dispatch -> implement`。`gxpm implement verify` 会生成 draft `local-verify`，用于解锁 `implement -> local-verify`。`gxpm local-verify ac-check` 会生成 draft `acceptance-check`，用于解锁 `local-verify -> ac-check`。`gxpm ac-check self-review` 会生成 draft `self-review`，用于解锁 `ac-check -> self-review`。`gxpm self-review ship` 会生成 draft `ship-readiness`，用于解锁 `self-review -> ship`。`gxpm ship pr-check` 会生成 draft `pr-check`，用于解锁 `ship -> pr-check`。`gxpm pr-check verify` 会生成 draft `verify-findings`，用于解锁 `pr-check -> verify`。`gxpm verify qa` 会生成 draft `qa-findings`，用于解锁 `verify -> qa`。
