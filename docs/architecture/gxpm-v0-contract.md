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
    land-findings.json
    local-verify.json
    pr-check.json
    qa-findings.json
    self-review.json
    ship-readiness.json
    triage-report.json
    verify-findings.json
  reports/
  evidence/
    command-logs/
    browser-snapshots/
    browser-screenshots/
    browser-console/
    browser-errors/
    investigations/
    review/
    release/
    screenshots/
  memory/
    resume-packet.json
    checkpoints/
      20260427-044500-handoff.md
  runs/
    run-20260428123000-1a2b3c4d.json
```

V0 已支持 JSON artifact store。当前 artifact type：

- `issue-intake`
- `triage-report`
- `acceptance-contract`
- `implementation-plan`
- `dispatch-handoff`
- `wiki-context`
- `local-verify`
- `acceptance-check`
- `self-review`
- `ship-readiness`
- `pr-check`
- `verify-findings`
- `qa-findings`
- `land-findings`

V0 只写 JSON artifact，不渲染 markdown report。

### Evidence Store

V0 的 issue-local evidence 统一由 `core/evidence.ts` 分配路径和写入。调用方必须提供 issue id、evidence kind、安全文件名、媒体类型和 payload；helper 负责复用 `core/state.ts` 的 issue id 校验、确认 issue state 存在、创建目标 evidence 子目录，并阻止文件名穿越 issue 目录。

当前 evidence kind 覆盖 command logs、browser snapshots/screenshots/console/errors、investigations、review 和 release。`screenshots` 保留给已有 `gxpm-investigate` 证据路径以维持兼容；新的 browser runtime 证据优先使用更具体的 `browser-*` kind。

Evidence Store 只管理 issue-local files，不替代 phase artifact store；阶段结论仍写入 `artifacts/*.json`，原始截图、console、review 或命令日志写入 `evidence/`。

### Resume Packet / Checkpoint

V0 的上下文恢复入口是 issue-local memory，而不是聊天历史或 gstack runtime：

- `gxpm issue checkpoint <issue-id> --title <title> --stdin`：读取 JSON payload，写入 append-only markdown checkpoint，并更新 `memory/resume-packet.json`。
- `gxpm issue resume <issue-id>`：读取 `resume-packet.json`，打印 phase、checkpoint path、summary、remaining work 和 notes，供新对话恢复上下文。

checkpoint payload 至少包含 `summary`，可选 `decisions`、`remainingWork`、`notes`、`filesModified`、`status`、`sessionDurationSeconds`。`memory/resume-packet.json` 是恢复流程的机器可读入口，markdown checkpoint 是人类可读交接文档。

### Run Ledger / Workspace Runtime

V0 的执行运行时先提供可审计原语，不启动长驻 daemon：

- run ledger 保存在 `.gxpm/issues/<issue-id>/runs/`，每条 run 记录包含 `runId`、`attempt`、`status`、`sessionId`、`workspacePath`、失败原因和事件序列。
- workspace runtime 负责把 issue 映射到安全的 per-issue workspace 路径，默认根目录来自 `workspace.root`（默认 `.gxpm/local/workspaces`），并提供 plan / ensure / cleanup 三个动作。
- orchestrator dry-run tick 只读本地 `.gxpm` issue state，报告哪些 issue 可派发、哪些被 phase/artifact 阻塞；它不 claim、不启动 agent、不写 phase state。

这些运行时原语属于 Capability Runtime 的 execution 层，但不改变 phase 顺序，也不替代 phase artifact gate。

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

`qa -> land` 额外要求存在 `land-findings` artifact。缺失时 transition 必须失败，并提示先运行 `gxpm qa land <issue-id>`。

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

V0 的 first-party capability contract 由 `core/capabilities.ts` 维护，并可通过只读命令 `gxpm capability list` / `gxpm capability show <capability-id>` 检查。registry 只描述合同和证据要求，不负责动态加载、执行插件或绕过 phase/artifact gate。

`verification.issue-evidence-store` 是 V0 的共享 evidence 写入能力。它只能在目标 issue 的 `evidence/` 目录内创建或覆盖文件，不能隐式推进 phase、写 phase artifact、claim issue 或调用外部 provider。

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
gxpm issue checkpoint <issue-id> --title "handoff" --stdin
gxpm issue resume <issue-id>
gxpm issue ready
gxpm issue claim <issue-id>
gxpm issue release <issue-id>
gxpm issue reconcile-claim <issue-id>
gxpm capability list
gxpm capability show <capability-id>
gxpm run start <issue-id> [--claim]
gxpm run list <issue-id>
gxpm run status <issue-id> <run-id>
gxpm run event <issue-id> <run-id> --type <event>
gxpm workspace plan <issue-id>
gxpm workspace ensure <issue-id>
gxpm workspace cleanup <issue-id>
gxpm orchestrator tick --dry-run
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
gxpm qa land <issue-id>
```

`gxpm issue create` 默认进入 `triage`。`gxpm issue transition` 不支持跳 phase 或 force。`gxpm triage init` 会生成 draft `acceptance-contract`，用于解锁 `triage -> plan`。`gxpm plan init` 会生成 draft `implementation-plan`，用于解锁 `plan -> dispatch`。`gxpm dispatch init` 会生成 draft `dispatch-handoff`，用于解锁 `dispatch -> implement`。`gxpm implement verify` 会生成 draft `local-verify`，用于解锁 `implement -> local-verify`。`gxpm local-verify ac-check` 会生成 draft `acceptance-check`，用于解锁 `local-verify -> ac-check`。`gxpm ac-check self-review` 会生成 draft `self-review`，用于解锁 `ac-check -> self-review`。`gxpm self-review ship` 会生成 draft `ship-readiness`，用于解锁 `self-review -> ship`。`gxpm ship pr-check` 会生成 draft `pr-check`，用于解锁 `ship -> pr-check`。`gxpm pr-check verify` 会生成 draft `verify-findings`，用于解锁 `pr-check -> verify`。`gxpm verify qa` 会生成 draft `qa-findings`，用于解锁 `verify -> qa`。`gxpm qa land` 会生成 draft `land-findings`，用于解锁 `qa -> land`。
