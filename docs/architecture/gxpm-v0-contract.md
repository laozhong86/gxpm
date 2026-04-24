# gxpm V0 合同

## 北极星

gxpm 是代理项目管理控制面。它把 Linear issue、阶段状态、执行代理、验证证据、浏览器 QA、评审和发布收口整合到同一个可恢复流程里。

## 非目标

- 不在 V0 重写 PMC。
- 不在 V0 复制 gstack 全技能树。
- 不在 V0 实现完整 browser daemon。
- 不让 gxpm 直接承担所有 worker 的实现细节。

## 核心对象

### Project

一个 gxpm 管理的代码项目或产品项目。Project 需要声明：

- issue provider：默认 Linear。
- state root：默认 `.gxpm/issues/<issue-id>/`。
- artifact root：默认同 state root。
- skill bindings：不同阶段调用哪些 worker/reviewer/browser 能力。

### Issue

Issue 是状态机实例。Issue 的本地真值必须在文件系统中存在，Linear 只是前门和同步面。

建议目录：

```text
.gxpm/issues/<issue-id>/
  state.json
  issue.json
  acceptance-contract.json
  dispatch.md
  local-verify.json
  local-verify.md
  ac-check.json
  verify-findings.json
  verify-report.md
  qa-findings.json
  qa-report.md
  land-findings.json
  resume-packet.json
  execution-log.md
  execution-memory.md
```

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

V0 兼容 PMC 的语义，但允许 gxpm 后续把 gstack-style skills 挂到各 phase。

## Source of Truth

真值优先级：

1. phase JSON artifacts
2. `state.json`
3. `resume-packet.json`
4. rendered markdown reports
5. Linear comments / PR body / chat history

任何恢复流程都必须先读本地 phase/state，而不是从聊天上下文猜。

## Ability Adapter

gxpm 不直接内置所有能力，而是定义 adapter：

- `issueProvider`：Linear read/write/sync。
- `workerProvider`：实现任务的代理或本地工具。
- `reviewProvider`：代码评审、specialist review、adversarial review。
- `browserProvider`：浏览器 QA、截图、console/network evidence。
- `shipProvider`：PR、版本、changelog、release handoff。
- `memoryProvider`：timeline、learn、context restore。

每个 adapter 必须声明：

- input contract
- output artifact
- failure mode
- idempotency rule
- 是否允许 mutation

## 与 PMC 的关系

PMC 是 V0 的参考实现和兼容对象。

gxpm 应复用 PMC 的优秀部分：

- phase gating
- checkpoint
- Linear team key/source discipline
- acceptance/local-verify/verify/qa artifact contracts
- execution continuity

gxpm 不应复制 PMC 的不足：

- QA 只停留在合同层。
- skill routing 与能力发现不够系统。
- 对 review/ship/design/devex/security/canary 的能力聚合不完整。

## 与 gstack 的关系

gstack 是 V0 的框架参考。

gxpm 应吸收：

- preamble/config/session/timeline/learn 模式。
- template-generated skill docs。
- browser daemon 的设计原则。
- `/review`、`/qa`、`/investigate`、`/ship` 的证据和循环机制。
- team install 与 host abstraction 的思路。

gxpm 不应照搬：

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
- 每个外部能力都有 adapter contract。
- 失败时能降级为本地报告，而不是把状态写坏。
