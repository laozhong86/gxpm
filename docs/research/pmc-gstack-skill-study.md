# PMC 与 gstack skill 调查

日期：2026-04-24

## 调查对象

- PMC skill：`/Users/x/.agents/skills/pmc`
- gstack for Claude：`/Users/x/.claude/skills/gstack`
- gstack for Codex wrapper：`/Users/x/.codex/skills/gstack`

## PMC 的核心能力

PMC 是状态驱动的 Linear issue 交付编排器。它的价值不是写代码，而是把问题从 triage 推进到 land，并在每个阶段留下可恢复、可审计、可复核的产物。

关键事实：

- 入口文件要求先读 `.omc/pm/<issue>/state.json`，不能凭聊天记忆判断阶段。
- 阶段路由为 `triage -> plan -> dispatch -> implement -> pr-check -> verify -> qa -> land`。
- 工作流合同中还有更细的 canonical state machine：
  `dispatch -> implement -> local-verify -> ac-check -> self-review -> ship -> doc-release -> pr-check -> verify -> qa -> land`。
- Linear team key 固定为 `GXG`，Linear 是协作前门，不是执行器。
- 每个阶段都应写入 `.omc/pm/<issue>/...` 下的 JSON/Markdown 产物，并通过 checkpoint 更新状态。
- 对 bug 工作有 T0/T1/T2 分级；非机械 bug 需要假设、实验和 DEBUG 记录。

PMC 高价值模块：

- `references/phases/`：每个阶段的最小执行指南。
- `references/workflow-contract.md`：阶段机和阻塞规则。
- `references/acceptance-contract.md`、`local-verify-contract.md`、`verify-findings-contract.md`、`qa-findings-contract.md`：产物合同。
- `references/execution-continuity*.md`：上下文丢失后的恢复合同。
- `scripts/state/checkpoint.py`、`scripts/state/linear_sync.py`：状态推进和 Linear 同步基础。
- `scripts/render_*_report.py` 与 `write_local_verify.py`：结构化产物到可读报告的桥。

PMC 的限制：

- 强在 issue lifecycle，但不是完整的软件工厂。
- QA/browser 能力以合同为主，缺少 gstack 那种持久浏览器 runtime。
- 评审、ship、design/devex、安全、benchmark、canary 等能力需要外部 skill 或人工补齐。
- 技能发现、上下文恢复、自学习、版本升级、team install、preamble 生成等框架能力相对弱。
- `/pm land` 按既有结论应只做 gate/handoff，具体 develop merge 交给 merge skill，不应自己定义一套 merge 规范。

## gstack 的核心能力

gstack 是一个把 Claude Code 扩展成“虚拟工程团队”的技能框架。它的能力不只是一组 prompts，而是一套技能分发、持久浏览器、上下文恢复、学习、review/QA/ship 的组合。

关键事实：

- active gstack 安装在 `/Users/x/.claude/skills/gstack`，Codex 侧 `/Users/x/.codex/skills/gstack` 是轻量 wrapper/symlink 面。
- gstack skill 文档由 `SKILL.md.tmpl` 自动生成，减少命令和文档漂移。
- 每个 skill 都有 preamble：版本检查、会话计数、配置读取、telemetry 开关、路由提示、context recovery、learning。
- 浏览器能力采用 long-lived Chromium daemon：CLI 读 `.gstack/browse.json`，通过 localhost HTTP 调 server，server 再通过 CDP 控制 Chromium。
- 浏览器 server 使用 bearer token、本地绑定、状态文件 0600、cookie 只读复制和 Keychain 授权。
- 技能覆盖 office-hours、plan、review、investigate、qa、ship、land-and-deploy、canary、benchmark、security、document-release、retro、learn 等完整交付链。

gstack 高价值模块：

- `ARCHITECTURE.md`：browser daemon、ref system、logging、模板生成和测试体系。
- `docs/skills.md`：技能地图和角色分工。
- `browse/`：持久浏览器 runtime。
- `qa/`：Test -> Fix -> Verify loop、health score、截图证据、回归测试生成。
- `review/`：diff review、specialist dispatch、adversarial review、fix-first。
- `ship/`：base merge、测试、review、版本/变更日志、PR。
- `investigate/`：root cause first、3-strike、scope lock、verification report。
- `bin/gstack-*`：配置、升级、timeline、learning、team init、repo mode 等基础设施。

gstack 的限制：

- 默认面向代码交付和浏览器 QA，不是 Linear-first 的 PM 状态机。
- 很多流程强绑定 Claude Code 语境，需要抽象成跨宿主协议后才能被 gxpm 复用。
- `/ship` 是自动化 release flow；gxpm 应保留用户确认和 PMC gate，不应照搬所有自动推送/PR 语义。
- gstack 强调完整性，但 gxpm 需要区分“可 boil 的 lake”和跨项目、跨团队、跨季度的 ocean。

## gxpm 的替代方向

gxpm 应该采用“重新抽象后的统一产品架构”，而不是“PMC 为骨架，gstack 为肌肉”的组合式 wrapper。

PMC 和 gstack 都应该被拆成 capability source：

- PMC 贡献项目管理状态机、Linear 协作面、artifact gate、checkpoint 和可恢复执行。
- gstack 贡献技能运行时、浏览器 runtime、QA/review/ship/investigate、context recovery、learn/timeline 和团队化安装。
- gxpm 负责把这些能力重新定义成统一 state graph、capability runtime、evidence store、policy engine 和 product CLI/skill surface。

吸收 PMC：

- Linear issue 入口与同步。
- 阶段状态机、checkpoint、artifact-first truth。
- acceptance/local-verify/verify/qa/land 合同。
- gate-first 而不是 worker-first 的责任边界。

吸收 gstack：

- skill preamble 框架：版本、配置、会话、路由、上下文恢复。
- browser daemon 或 browser adapter：为 PMC `qa` phase 提供真实 browser evidence。
- review/qa/ship 的 report schema 和可验证证据习惯。
- learn/timeline/context-save/context-restore 的持久上下文机制。
- template-generated skill docs，避免手写命令漂移。
- specialist map：review、security、design、devex、benchmark、canary 等作为可选能力包。

避免：

- 不把 gxpm 写成 PMC/gstack 的兼容壳。
- 不保留 `.omc` 与 `.gstack` 两套长期真值。
- 不把 gstack 整树 vendoring 进 gxpm。
- 不把 PMC phase guide 简单改写成另一个手册。
- 不让 Linear 执行代码或替代本地状态。
- 不在 V0 同时实现所有 runtime、browser、review、ship、deploy 能力。

## 建议的 V0 定义

V0 只做四件事：

1. 定义 gxpm 原生 state graph、artifact store、evidence store。
2. 定义 capability runtime：issue、planning、execution、review、browser、release、memory、skill。
3. 建立 PMC/gstack replacement map，明确每项旧能力迁移到哪个 gxpm 模块。
4. 写出 gxpm skill 入口，让代理能先读 state，再按最小引用面加载对应 gxpm capability guide。

V0 成功信号：

- 一个代理能在不加载 PMC/gstack 的情况下，从 gxpm issue/state 进入正确阶段。
- 每个阶段都知道调用哪个 gxpm capability、写哪些产物、什么时候停止。
- browser QA 能力被定义为 adapter/gate，而不是散落在 prompt 里的“去测一下”。
- Linear 同步失败时可以安全降级，本地状态仍然完整。
