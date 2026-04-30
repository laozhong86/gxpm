# gxpm Development Contract

## 目的

本文件把 gstack 中有效的开发规范转成 gxpm 的可执行合同。`AGENTS.md` 保持薄入口，本文件作为开发、验证、提交和失败归因的渐进加载规则。

## 命令分层

| Tier | Command | 何时运行 | 目标 |
| --- | --- | --- | --- |
| fast | `bun test` | 每次实现后、提交前 | 免费静态验证和单元测试 |
| gate | `bun run check` | 提交前、生成器或 governance 改动后 | host config、生成文档和治理文档检查 |
| generated | `bun run gen:skill-docs` | 修改 `*.tmpl`、host config、preamble 后 | 刷新生成的 skill surface |
| state | `gxpm issue create/status/transition` | state graph 或 phase 规则改动后 | 本地 `.gxpm` 真值写回和恢复验证 |
| capability | `gxpm capability list/show` | 新增或修改 runtime capability contract 后 | 检查 input/output、mutation、idempotency、failure mode 和 evidence metadata |
| runtime | `gxpm issue ready/claim/release/reconcile-claim`、`gxpm run start/list/status/event`、`gxpm workspace plan/ensure/cleanup`、`gxpm orchestrator tick --dry-run` | claim lifecycle、run ledger、workspace runtime、orchestrator dry-run 改动后 | 执行运行时原语、路径安全、只读派发判断 |
| artifact | `gxpm triage init`、`gxpm plan init`、`gxpm dispatch init`、`gxpm implement verify`、`gxpm local-verify ac-check`、`gxpm ac-check self-review`、`gxpm self-review ship`、`gxpm ship pr-check`、`gxpm pr-check verify`、`gxpm verify qa`、`gxpm qa land`、`gxpm artifact list/read` | artifact store 或 phase gate 改动后 | 产物写入、读取、索引和 gate 验证 |
| context | `gxpm wiki init`、`gxpm wiki update`、`gxpm wiki query <text>`、`gxpm wiki status` | 需要仓库知识库上下文、代码改动后刷新本地 wiki，或仓库存在 `.qoder/repowiki` 时 | 原生 wiki 上下文、本地索引/图谱刷新、Qoder 可选导航与手动同步提醒 |
| future-e2e | 待实现 | browser/runtime capability 落地后 | 真实浏览器和 agent workflow 证据 |
| future-eval | 待实现 | 高风险 prompt/capability 改动 | LLM judge 或 paid eval，需先确认成本 |

## 生成物规则

- `SKILL.md.tmpl` 是真值，`SKILL.md` 是生成产物。
- 修改模板后必须运行 `bun run gen:skill-docs` 并提交模板与生成物。
- 生成物冲突只能通过模板和生成器解决，再重新生成。
- `bun run check` 必须能发现生成物漂移。
- scaffold check 流程的真值是 `scripts/scaffold-check.ts`；`gxpm check` 和 `gxpm-check.ts` 只能调用它。
- skill 模板中的 gate command、artifact read list 和 transition summary 必须由 `scripts/gen-skill-docs.ts` 从 phase gate registry 生成。
- README 只展示稳定入口命令，不复制完整 phase gate 链；完整 gate guidance 以生成的 `skills/gxpm/SKILL.md` 为准。
- `docs/architecture/gxpm-v0-contract.md` 可保留人类可读列表，但必须由测试证明和 phase、artifact、gate registry 一致。

## Phase Artifact 规则

- 新增 phase artifact initializer 时，优先使用 `core/phase-artifact.ts` 的 `createPhaseArtifactInitializer`。
- initializer 文件只声明 required phase、artifact type、label 和 draft payload。
- 不要在每个 initializer 中重复 `readIssueState`、phase 校验和 `writeArtifact` 样板。
- `triage` 这类没有前置 phase gate 的入口 artifact 可以保留专用实现。
- `ARTIFACT_TYPES` 可以包含 non-gate artifact；只有 `GATE_ARTIFACT_TYPES` 需要 phase gate command 和 initializer 绑定。
- 新增 artifact-backed transition 时，必须先更新 `core/phase-gates.ts`；`scripts/phase-artifact-commands.ts` 只绑定 initializer 和 success message。
- `test/phase-gates.test.ts` 必须证明 CLI artifact command 顺序和 gate rule 顺序保持一致。
- gate 测试需要把通用 phase setup 放在 `test/helpers/workflow.ts`，不要在每个 gate 文件重复写完整前置 phase 链。
- `test/helpers/workflow.ts` 的 phase setup 顺序必须从 phase gate registry 派生，不再手写第二份 workflow chain。
- gate 测试文件只保留当前 gate 的 artifact payload、blocked event、CLI command 和 transition 断言。

## Execution Runtime 规则

- `core/capabilities.ts` 是 runtime capability contract 的描述性 registry。新增 capability slice 时，先声明 input/output、mutation scope、idempotency、failure modes、commands 和 source anchors，再接执行实现。
- `gxpm capability list/show` 必须保持只读；它只能检查 registry，不得执行 capability、写 artifact、claim issue 或调用外部 provider。
- `gxpm run *` 只记录或读取 issue-local run ledger；不得隐式推进 phase。
- `gxpm issue claim/release/reconcile-claim` 只更新本地 issue claim 生命周期；不得隐式推进 phase。
- `gxpm workspace plan` 是只读路径规划；`ensure` 只创建/复用当前 issue workspace；`cleanup` 只能删除该 issue 对应 workspace。
- workspace key 必须由 issue identifier 派生并限制在 `[A-Za-z0-9._-]`，不允许把用户输入拼进任意路径。
- `gxpm orchestrator tick --dry-run` 必须保持只读：不 claim、不创建 workspace、不启动 agent、不写 artifact、不 transition。
- 真正的长驻 poll/retry daemon 需要另行设计；不要把 dry-run tick 偷偷扩成后台服务。

## 失败归因协议

不要直接说“这是旧问题”或“与本次无关”。需要满足以下任一证据：

1. 同一命令在 base/main 上也失败。
2. 有仓库已有记录证明该失败是基线噪声。
3. 无法验证时，明确标记为“未验证，可能相关”，并把风险写进汇报。

## 提交规则

- 每个提交只表达一个逻辑变化。
- 模板改动和生成物刷新可以同一提交，但不要混入无关重构。
- 测试基础设施、host adapter、产品文档变更应尽量独立，便于回滚。
- 提交前至少运行 `bun test`、`bun run check`、`git diff --check`。
- 主目录 checkout 必须保持在 `main`。`gxpm gate branch-policy` 会阻止 canonical main checkout 在非 `main` 分支上提交或推送；feature 分支应在 dedicated git worktree 中运行。

## Live Install 风险

未来 gxpm 支持本地 `.agents/` 或 `.claude/` dev install 后，修改模板和生成器可能立即影响其他会话。大改前先确认：

- 当前 host skill 是 symlink 还是 copy。
- 是否有并行会话依赖当前安装。
- 是否需要先切回稳定全局安装或隔离 worktree。

## 需求确认 / Brainstorming Gate

- 新的非平凡任务或范围变化，先做 read-only 探查，再给用户确认目标、范围、非目标、成功标准和预计改动。
- 优先使用当前 host 的原生选择表单。Codex 中如果 `request_user_input` 在当前模式可用，就用 1 个短问题和 2-3 个互斥选项；不可用时用简短文字确认，不伪装成表单。
- 用户明确说“直接做 / 继续推进 / 按已有计划执行”时，可以跳过确认闸门。
- 外部 tracking id 只能写入 artifact 作为来源信息，不作为 GXPM-N；本地 issue 永远用 `gxpm issue create --auto-id`。
- Superpowers 和 gstack 只作为上游交互模式参考，不能引入为 gxpm 运行时依赖。

## gxpm 原生 Wiki

- `gxpm wiki init` 生成 gxpm 自有的 `.gxpm/wiki/index/files.json`、`.gxpm/wiki/index/graph.json`、`.gxpm/wiki/content/` 和 `.gxpm/wiki/state.json`。
- `gxpm wiki update` 在代码变更后刷新本地 wiki；V1 是确定性本地索引、导入图谱和 Markdown 概览，不调用 Qoder、IDE 或外部付费服务。
- `gxpm wiki status` 同时报告原生 wiki 的 absent/current/stale 状态和 Qoder 可选导航状态。原生 wiki stale 的标准包括 state/index 缺失、`baseCommit` 落后当前 `HEAD`、或已索引的 git-tracked 文件发生变更。
- 原生 wiki 优先使用 `git ls-files` 索引 git-tracked 文本文件；git 不可用时退回同样 skip-list 的本地扫描。`.codex/`、`.claude/`、`.gxpm/`、`.qoder/` 等 ignored/local/generated 内容以及未跟踪 scratch 文件不得进入仓库知识索引。
- `gxpm wiki query <text>` 基于结构化索引返回 context files 和 suggested docs，适合作为 triage、plan、dispatch、implement 的第一层本地知识入口。
- `gxpm wiki context <issue-id>` 基于 issue state/artifacts 生成查询并返回相关 context files 与 suggested docs；需要把结果落盘时使用 `--write-artifact` 写入 `wiki-context` artifact。
- `.gxpm/wiki/` 保持 git 外状态；需要提交的是生成逻辑、契约和测试，不提交具体仓库 wiki 内容。

## Qoder Wiki 可选集成

- `.qoder/repowiki` 是可选导航层，不是 gxpm 状态真值；缺失时不得阻塞正常 issue workflow。
- `.qoder/repowiki` 是 Qoder 自动生成内容，应保持在 git 版本管理之外；仓库只保留 `.gitignore` 规则和 gxpm 的检测/链接能力。
- 本机共享 wiki 默认放在 `.gxpm/local/qoder/repowiki`。新 worktree 需要复用 wiki 时，运行 `gxpm qoder link --target <worktree-path>` 创建 `.qoder/repowiki` 软链。
- 如果主仓库里已经有真实 `.qoder/repowiki` 目录，首次迁移用 `gxpm qoder link --replace` 把目录移动到共享位置并留下软链。
- 新会话或代码读取前，如目录存在，先运行 `gxpm wiki status`，优先读 content markdown 和其中引用的 source anchors，不把 `repowiki-metadata.json` 大段塞进上下文。
- 代码改动后，如 `gxpm wiki status` 报告手动同步证据超过 7 天或尚未记录，提醒用户执行 Qoder wiki 手动更新/重新同步。
- gxpm 不自动调用 Qoder 外部同步；人工同步后用 `gxpm wiki mark-sync --note <说明>` 记录证据，提醒后可用 `gxpm wiki mark-reminder --note <说明>` 降低重复提醒噪音。

## 长任务规则

长时间测试、E2E、浏览器验证和部署验证必须持续轮询到结束。不能把“后台会通知”当作完成证据。每次轮询只汇报新进展、失败和下一步。

## 文档边界

- `AGENTS.md` 只放不可推断的执行边界。
- `CLAUDE.md` 只放 Claude Code 启动差异。
- 专项规则放 `docs/governance/`，不要把所有细节塞回根文件。
