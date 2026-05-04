# Archon 调查

日期：2026-05-04

## 调查对象

- Archon 主仓库：`/Users/x/Desktop/Project/github/archon`
- 技术栈：Bun + TypeScript + SQLite/PostgreSQL + Hono + Zod OpenAPI

## Archon 的核心能力

Archon 是一个**面向 AI coding agent 的工作流引擎**。它的核心主张是：把开发流程编码为 YAML 工作流，让 AI 在每个步骤填充智能，但结构由人类拥有且确定可重复。类比：Dockerfile 之于基础设施，GitHub Actions 之于 CI/CD，Archon 之于 AI coding 工作流。

关键事实：

- **Workflow DAG**：YAML 定义节点和 `depends_on` 边，同层独立节点并发执行。节点类型包括 `prompt`（AI）、`bash`（确定性脚本）、`loop`（迭代直到信号）、`approval`（人工 gate）、`script`（TypeScript/Python）、`command`（命名命令文件）。
- **Git Worktree 隔离**：每个 workflow run 自动创建独立 worktree，支持并行运行无冲突。`bun run cli workflow run` 默认带隔离，`--no-worktree` 显式退出。
- **确定性 Phase + Validation Gate**：工作流定义 phase、验证门和产物；AI 填充每步的智能，但结构不变。
- **Artifacts + Evidence 双轨**：workflow artifacts 写入 `~/.archon/workspaces/owner/repo/artifacts/runs/{id}/`（永不入 git）；原始命令输出、截图等作为证据留存。
- **Multi-Platform**：CLI、Web UI（React + Vite + SSE）、Slack（轮询）、Telegram（Bot API）、GitHub（webhook + gh CLI）、Discord（WebSocket）。统一 conversation 接口。
- **Session 不可变 + Transition 审计链**：session 之间通过 `parent_session_id` 链接，`transition_reason` 记录为什么创建新 session（plan→execute 等）。
- **AI Provider 抽象**：`IAgentProvider` 接口，内置 Claude、Codex、Pi（community，~20 LLM backends），provider-specific 选项内部翻译。
- **Monorepo 分层架构**：9 个 package 按依赖方向严格分层：
  - `@archon/paths`（零依赖）→ `@archon/git` → `@archon/isolation` / `@archon/workflows` → `@archon/core` → `@archon/adapters` → `@archon/server` → `@archon/web` / `@archon/cli`
- **Rollback-First 工程原则**：小范围变更、明确 blast radius、 risky 变更先定义回滚路径、避免 mixed mega-patches。
- **No Autonomous Lifecycle Mutation Across Process Boundaries**：当一个进程无法区分“正在别处活跃运行”和“已崩溃孤儿”时，不得基于计时器或陈旧猜测自动将工作标记为失败/取消。必须将模糊状态暴露给用户并提供一键操作。
- **Bundled Defaults + 层级覆盖**：默认命令和工作流编译嵌入二进制；加载优先级：bundled < global（`~/.archon/`）< project（`.archon/`），同名覆盖。
- **丰富的变量替换体系**：`$1/$2/$3`、`$ARGUMENTS`、`$ARTIFACTS_DIR`、`$BASE_BRANCH`、`$LOOP_PREV_OUTPUT`、`$REJECTION_REASON` 等，支持节点间数据传递。

## Archon 高价值模块

- `CLAUDE.md`：829 行的工程合同，涵盖核心原则、类型安全规范（Zod）、Git 工作流、开发命令、架构分层、目录结构、数据库 schema、配置优先级、API 端点、错误处理、日志规范、测试隔离规则等。
- `.github/pull_request_template.md`：极为严格的 PR 模板，要求 UX Journey（Before/After ASCII 流）、架构图（Before/After + Connection inventory）、Label Snapshot（risk/size/scope/module）、Validation Evidence、Security Impact、Compatibility/Migration、Human Verification、Blast Radius、Rollback Plan。
- `packages/workflows/`：工作流引擎核心 — loader、router、executor、DAG executor、validator、event-emitter、logger、defaults。
- `packages/core/src/orchestrator/`：AI conversation 管理、变量替换、session 生命周期。
- `packages/git/` 与 `packages/isolation/`：worktree 操作、分支管理、隔离环境解析、错误分类器。
- `packages/providers/`：AI provider 注册表、Claude/Codex/Pi 适配、零 SDK 依赖的 `providers/types` 契约子路径。
- `packages/server/src/routes/api.ts`：REST API + OpenAPI 规范自动生成（`@hono/zod-openapi`），workflow CRUD、run lifecycle、artifact serving、codebase 管理。
- `.archon/workflows/defaults/` 与 `.archon/commands/defaults/`：内嵌默认工作流和命令（如 `assist`、`plan`、`implement` 等），通过 `bun run generate:bundled` 编译进二进制。
- `.archon/config.yaml`：assistant 级别默认配置（model、settingSources、binaryPath 等），支持 workflow-level 覆盖。

## Archon 的限制

- **单开发者工具定位**：明确声明无多租户复杂度，这意味着团队级权限、并发 claim、角色隔离不在当前范围内。
- **Workflow YAML 的学习成本**：虽然比代码简单，但要充分利用 DAG、loop、approval、trigger_rule、join semantics 等高级特性，用户需要学习 Archon 的 workflow DSL。
- **AI Provider 覆盖有限**：虽然支持 Claude、Codex、Pi，但对国内模型或自托管模型的接入仍需社区扩展。
- **无原生 Issue Tracker 集成**：没有 Linear / GitHub Issues 的状态机绑定，workflow 是通用的，不感知项目管理的 phase gate。
- **Session 不可变导致上下文累积**：虽然 session 有 transition 审计链，但单个 session 内的上下文仍然会累积；没有 GSD 那种“每个 agent 干净上下文”的显式设计。
- **Bun 生态依赖**：编译二进制、mock.module() 隔离测试、SQLite 内置等特性强绑定 Bun，迁移到 Node.js 成本高。

## gxpm 的借鉴方向

Archon 最核心的贡献是**把 AI coding 流程结构化为可拥有、可重复、可隔离的工作流**：

1. **Workflow DAG + Phase Gate**：gxpm 的 `triage → plan → dispatch → implement → ... → land` 可借鉴 Archon 的 DAG executor，把线性 phase 链扩展为支持并发验证门（如 `local-verify` 和 `self-review` 可并行）的图结构。
2. **Git Worktree 隔离**：gxpm 已有 worktree 概念，但 Archon 的“每次 run 自动创建 worktree + 端口自动分配 + 确定性复用”是更成熟的工程实现。`packages/isolation/` 的错误分类器和 provider factory 可直接参考。
3. **Artifacts + Evidence 双轨**：gxpm 的 `artifacts/*.json`（gate 结论）和 `evidence/`（原始证据）与 Archon 的 artifacts/evidence 分层高度一致，应吸收其路径分配、run-scoped 隔离和不可入 git 的约定。
4. **PR 模板与安全/回滚门**：Archon 的 PR template 要求 Security Impact、Rollback Plan、Blast Radius、Human Verification，这种“对抗性自查”应成为 gxpm `ship` / `self-review` 阶段的 artifact 字段。
5. **No Autonomous Lifecycle Mutation**：这条原则对 gxpm 的 orchestrator dry-run 和 claim lifecycle 至关重要 —— gxpm 不应让某个进程基于超时猜测就把 issue 标记为失败。
6. **Bundled Defaults + 层级覆盖**：gxpm 的 skill 和 workflow 默认值可采用“编译嵌入 + global < project 覆盖”的模式，减少每个项目的初始化成本。
7. **变量替换与节点间数据传递**：Archon 的 `$nodeId.output`、`$LOOP_PREV_OUTPUT`、`$REJECTION_REASON` 等机制，可为 gxpm 的 artifact 引用和跨-phase 数据传递提供设计参考。
8. **Monorepo 分层与接口隔离**：Archon 的 package 分层（paths → git → isolation/workflows → core → adapters → server）和 `IAgentProvider` / `IPlatformAdapter` / `IWorkflowStore` 窄接口，是 gxpm 拆分 runtime adapter 的优先参考。

## 深度工程实践拆解

以下十条是 Archon 最值得 gxpm 直接借鉴的工程实践，按“结构 → 韧性 → 可观测性 → 治理”排序。

---

### 1. DAG Executor：拓扑排序 + 并发层 + Trigger Rule + When Condition

**代码位置**：`packages/workflows/src/dag-executor.ts`（`executeDagWorkflow`，~2481 行起）、`packages/workflows/src/loader.ts`（`validateDagStructure`）

**Archon 怎么做**：

1. **拓扑分层**：`buildTopologicalLayers()` 将 DAG 节点按依赖深度分层，同层节点用 `Promise.allSettled` 并发执行。
2. **Trigger Rule**：每个节点可配 `trigger_rule`，支持 `all_success`（默认）、`one_success`、`none_failed_min_one_success`、`all_done`。例如 code-review workflow 中 5 个并行 review agent 的 synthesize 节点配 `trigger_rule: one_success`，只要有一个 specialist 完成即可进入汇总。
3. **When Condition**：节点级条件门，支持 `$nodeId.output == 'VALUE'`、`$nodeId.output > '5'`、复合逻辑。解析失败时 **fail-closed**（跳过节点并告警），而不是 fail-open 继续执行。
4. **Resume 支持**：`priorCompletedNodes` 预填充已完成的节点输出，重新运行workflow 时自动跳过成功节点，只重试失败/未执行节点。
5. **Session Threading**：同层只有一个节点时，session 可向前传递（`lastSequentialSessionId`）；并行层强制 fresh session，避免上下文竞争。

**为什么值得借鉴**：

gxpm 当前的 phase 是严格线性链（`triage → plan → dispatch → implement → local-verify → ac-check → self-review → ship → ...`）。实际上 `local-verify` 与 `self-review` 可以并行，`ship` 前的多个检查（type-check / lint / test）也可以并发。DAG executor 可以把 gxpm 从“状态机”升级为“执行图”，在不改变 phase gate 语义的前提下缩短总执行时间。

**gxpm 落地建议**：

- 在 `core/phase-gates.ts` 中引入 `depends_on` 和 `trigger_rule` 概念，允许 artifact initializer 声明前置条件。
- `gxpm issue transition` 保持线性顺序不变，但 `gxpm run start` 执行时，把多个同层验证 capability 并发派发。

---

### 2. Isolation Resolver：六层解析策略 + 错误分类器

**代码位置**：`packages/isolation/src/resolver.ts`、`packages/isolation/src/errors.ts`、`packages/isolation/src/providers/worktree.ts`

**Archon 怎么做**：

`IsolationResolver.resolve()` 按以下顺序决策：

1. **Existing** — conversation 已绑定 isolation_env_id，直接复用。
2. **No codebase** — 无注册 codebase，跳过隔离（`cwd: '/workspace'`）。
3. **Workflow reuse** — 同一 codebase + 同一 workflow identity 的现有环境可复用。
4. **Linked issue sharing** — 跨 conversation 的 linked issue 共享隔离环境。
5. **PR branch adoption** — skill symbiosis：如果 PR branch 已存在对应 worktree，直接采用。
6. **Create new** — 以上都不满足，新建 worktree。

错误处理采用 **classifyIsolationError** 模式：

- `known: true` 的错误（权限拒绝、超时、无空间、非 git 仓库）→ 映射为用户友好的 blocked 消息， workflow 终止。
- `known: false` 的错误（无法提取 owner/repo、branch not found）→ 仍然分类，但 **crash 而不是吞掉**，因为它们是编程/输入 bug 而非基础设施故障。

**为什么值得借鉴**：

gxpm 当前的 worktree 逻辑靠人工 `cd` 和 hook 提醒（`git worktree add` 之后必须 `cd` 进新 worktree）。Archon 的 resolver 把隔离环境解析自动化、策略化、可测试化。

**gxpm 落地建议**：

- 把 `gxpm workspace ensure <issue-id>` 升级为 `IsolationResolver`，实现“现有 workspace 复用 → 同 issue 共享 → 新建 worktree”的自动决策。
- 引入 `core/isolation-errors.ts`，把 git worktree 错误（权限、冲突、非 git）映射为 actionable 用户消息，而不是裸抛 `git worktree add` 的 stderr。

---

### 3. 错误分类与韧性架构：classifyError + safeSendMessage + 重试策略

**代码位置**：`packages/workflows/src/executor-shared.ts`（`classifyError`）、`packages/workflows/src/dag-executor.ts`（`safeSendMessage`）、`packages/workflows/src/executor.ts`（`safeSendMessage` + `sendCriticalMessage`）

**Archon 怎么做**：

- `classifyError()` 将错误分为 **FATAL**（认证/权限/额度耗尽）、**TRANSIENT**（网络抖动、超时）、**UNKNOWN**（未识别）。
- `safeSendMessage()` 对 TRANSIENT 错误静默吞掉（返回 false），对 FATAL 错误直接 throw，对 UNKNOWN 错误追踪连续出现次数（`UNKNOWN_ERROR_THRESHOLD = 3`），超过阈值才 abort。
- `sendCriticalMessage()` 对关键通知（失败/完成）启用指数退避重试（1s, 2s, 3s...），最大 3 次。
- DAG 节点默认重试：`DEFAULT_NODE_MAX_RETRIES = 2`，仅对 TRANSIENT 错误重试，FATAL 不重试。

**为什么值得借鉴**：

gxpm 的 CLI 和 capability 调用目前对网络/平台错误的处理不够分层。一次暂时的网络抖动不应导致整个 issue run 失败，但认证错误也不应被无意义地重试 3 次。

**gxpm 落地建议**：

- 在 `core/capabilities.ts` 的 contract 中增加 `failureMode` 字段，声明每种 capability 的 FATAL / TRANSIENT / UNKNOWN 分类。
- `gxpm run start` 的 orchestrator 对 TRANSIENT 失败自动重试（带指数退避），对 FATAL 失败立即终止并写 `run-failure` artifact。

---

### 4. 变量替换与节点间数据流：$nodeId.output + buildPromptWithContext

**代码位置**：`packages/workflows/src/dag-executor.ts`（`substituteNodeOutputRefs`）、`packages/workflows/src/executor-shared.ts`（`buildPromptWithContext`、`substituteWorkflowVariables`）

**Archon 怎么做**：

- **Workflow 级变量**：`$1/$2/$3`、`$ARGUMENTS`、`$ARTIFACTS_DIR`、`$BASE_BRANCH`、`$DOCS_DIR`、`$LOOP_PREV_OUTPUT`、`$REJECTION_REASON`。
- **节点间引用**：`$nodeId.output` 和 `$nodeId.output.field`（JSON 解析后取字段）。在 bash 节点中自动做 shell-quote 转义（`'${value.replaceAll("'", "'\\''")}'`）。
- **Prompt 构建**：`buildPromptWithContext()` 统一处理所有变量替换，出错时 throw 明确消息（如 `$BASE_BRANCH` 被引用但 auto-detect 失败）。
- **Loader 验证**：`validateDagStructure()` 在 workflow 加载时就检查 `$nodeId.output` 引用是否指向已知节点，提前发现拼写错误。

**为什么值得借鉴**：

gxpm 当前的 artifact 和 evidence 之间没有显式的数据流机制。`gxpm artifact read` 是显式命令，但 skill/prompt 模板里无法像 `$nodeId.output` 那样直接引用上游产物。

**gxpm 落地建议**：

- 在 `SKILL.md.tmpl` 中引入 `{{ARTIFACT_OUTPUT:<type>}}` 占位符，由 `gen-skill-docs.ts` 自动替换为对应 artifact 的读取路径。
- `gxpm run start` 执行时，维护一个 `nodeOutputs` Map，让同 run 内的不同 capability 可以引用彼此的输出。

---

### 5. Session 不可变 + Transition 审计链

**代码位置**：`packages/core/src/state/session-transitions.ts`、`packages/core/src/db/sessions.ts`

**Archon 怎么做**：

- Session 是**不可变**的：任何 transition 都创建新的 linked session，而不是修改现有 session。
- `parent_session_id` 链接前一个 session，`transition_reason` 记录为什么创建新 session（`first-message`、`plan-to-execute`、`reset-requested`、`isolation-changed` 等）。
- `TRIGGER_BEHAVIOR` 用 TypeScript 的 `Record<TransitionTrigger, 'creates' | 'deactivates' | 'none'>` 保证编译时穷尽性：新增 trigger 必须分类，否则编译错误。
- 只有 `plan-to-execute` 是 `creates`（立即 deactivate + create），其他 trigger 只 `deactivates`（下一消息再创建）。

**为什么值得借鉴**：

gxpm 的 `memory/resume-packet.json` 是追加式更新，但没有 session 级别的不可变保证。如果某个 session 崩溃后恢复，可能读取到 half-written 的 checkpoint。

**gxpm 落地建议**：

- `gxpm issue checkpoint` 改为创建新的 checkpoint 文件（原子写：`.tmp` → `renameSync`），而不是覆盖现有文件。
- 在 checkpoint payload 中增加 `parentCheckpointId` 和 `transitionReason`，形成审计链。
- `gxpm issue resume` 读取最新的 checkpoint 时，同时打印 chain 长度（“这是该 issue 的第 N 个 checkpoint”）。

---

### 6. 事件驱动可观测性：WorkflowEventEmitter + fire-and-forget

**代码位置**：`packages/workflows/src/event-emitter.ts`

**Archon 怎么做**：

- 单例 EventEmitter，通过 `getWorkflowEventEmitter()` 全局访问。
- **类型安全**：每个事件类型都有明确的 TypeScript interface（`WorkflowStartedEvent`、`NodeCompletedEvent`、`LoopIterationFailedEvent` 等）。
- **Fire-and-forget**：listener 错误永远不会传播到 executor，避免观测逻辑拖垮工作流。
- **Conversation-scoped 订阅**：Web adapter 通过 `registerRun()` 把 SSE stream 绑定到特定 runId，只接收该 run 的事件。
- **事件持久化**：关键事件（`node_started`、`node_completed`、`node_failed`）同时写入数据库 `workflow_events` 表，即使 emitter 崩溃也能恢复状态。

**为什么值得借鉴**：

gxpm 当前的运行时可观测性主要依赖 CLI 输出和文件系统 artifact。缺乏一个统一的事件总线来让 Web UI、CLI、第三方平台实时订阅执行状态。

**gxpm 落地建议**：

- 在 `core/events.ts` 中建立类型化 EventEmitter，事件类型包括：`phase_transitioned`、`artifact_written`、`capability_started`、`capability_completed`、`evidence_captured`。
- CLI 默认订阅并打印关键事件；Web UI（未来）通过 SSE 订阅；第三方平台通过 webhook 订阅。
- 所有事件写入 `.gxpm/issues/<id>/events.jsonl`（追加式），作为 run ledger 的补充。

---

### 7. PR 模板对抗性治理：Security Impact / Blast Radius / Rollback Plan

**代码位置**：`.github/pull_request_template.md`

**Archon 怎么做**：

PR 模板强制要求填写以下对抗性字段：

- **Security Impact**（必填）：新权限？外部网络调用？Secrets 处理变更？文件系统访问范围变更？任何 Yes 必须描述风险和缓解措施。
- **Compatibility / Migration**：向后兼容？配置/环境变更？数据库迁移？升级步骤？
- **Human Verification**（必填）：个人验证了哪些场景？检查了哪些边界条件？**什么没有验证？**
- **Side Effects / Blast Radius**（必填）：影响哪些子系统？潜在 unintended effects？早期检测的 guardrails/monitoring？
- **Rollback Plan**（必填）：快速回滚命令？feature flag？可观测的失败症状？
- **Risks and Mitigations**：列出真实风险，不允许写 "None" 敷衍。

**为什么值得借鉴**：

gxpm 当前的 `ship-readiness` artifact 只要求存在，但没有强制字段列表。Agent 容易跳过 security impact 和 rollback plan 的深入思考。

**gxpm 落地建议**：

- 在 `docs/governance/development-contract.md` 中定义 `ship-readiness` artifact 的强制 JSON schema：
  ```json
  {
    "securityImpact": { "newPermissions": "No|Yes", "mitigation": "..." },
    "blastRadius": { "affectedSubsystems": ["..."], "unintendedEffects": "..." },
    "rollbackPlan": { "command": "...", "observableSymptoms": "..." },
    "humanVerification": { "scenarios": "...", "notVerified": "..." }
  }
  ```
- `gxpm self-review ship` 的 initializer 拒绝缺少任何必填字段的 payload。

---

### 8. Worktree 自测端口分配：路径哈希 → 确定性端口

**代码位置**：`packages/core/src/utils/port-allocation.ts`

**Archon 怎么做**：

- worktree 中的开发服务器自动分配端口：
  - `basePort = 3090`
  - `offset = (md5(worktreePath).readUInt16BE(0) % 900) + 100` → 端口范围 3190-4089
  - 同一 worktree 始终获得同一端口（确定性）
- `PORT=4000` 环境变量可显式覆盖。
- 如果 `PORT` 非法（非 1-65535），`process.exit(1)` 立即失败，而不是静默回退。

**为什么值得借鉴**：

gxpm 当前的 worktree 只隔离了文件系统，没有隔离开发服务器端口。多个 issue 的并行 worktree 同时运行 `bun dev` 时会发生端口冲突。

**gxpm 落地建议**：

- `gxpm workspace ensure <issue-id>` 为每个 workspace 计算确定性端口偏移（基于 issue-id 哈希）。
- 在 workspace metadata 中记录 `devPort`，skill 模板中的 `bun dev` 命令自动使用该端口。
- `gxpm workspace status` 显示每个 workspace 的占用端口。

---

### 9. Monorepo 分层与零 SDK 依赖契约层

**代码位置**：`packages/providers/src/types.ts`（文件头注释）、`packages/workflows/src/deps.ts`

**Archon 怎么做**：

- **`@archon/providers/types` 是零 SDK 依赖的契约子路径**。文件头硬规则：
  ```typescript
  // CONTRACT LAYER — no SDK imports, no runtime deps.
  // HARD RULE: This file must never import SDK packages or other @archon/* packages.
  ```
- `@archon/workflows` 只从 `@archon/providers/types` 导入，不直接依赖 Claude SDK 或 Codex SDK。
- `WorkflowDeps` 是注入式依赖包（store、getAgentProvider、loadConfig），workflow 引擎不直接实例化任何外部服务。
- Package 分层方向：`paths` → `git` → `isolation/workflows` → `core` → `adapters` → `server`。下层永不依赖上层。

**为什么值得借鉴**：

gxpm 当前的 `core/capabilities.ts` 是描述性 registry，但执行实现与 host SDK（Claude/Codex）耦合较紧。引入新的 host 时需要修改多处文件。

**gxpm 落地建议**：

- 在 `core/` 下建立 `contracts/` 目录，存放零依赖的 capability interface（如 `ICapabilityProvider`、`IAgentRunner`、`IBrowserRuntime`）。
- `hosts/claude.ts` 和 `hosts/codex.ts` 实现这些 interface，而 `core/` 的其他模块只依赖 `contracts/`。
- 新增 host（如 Gemini、Kilo）时，只需在 `hosts/` 下新增一个实现文件，不碰 `core/` 业务逻辑。

---

### 10. Bundled Defaults + 三层覆盖体系

**代码位置**：`packages/workflows/src/defaults/bundled-defaults.ts`、`packages/workflows/src/workflow-discovery.ts`

**Archon 怎么做**：

- 默认 workflow 和 command 在编译时嵌入二进制（`bun run generate:bundled` 生成 `bundled-defaults.generated.ts`）。
- 三层加载优先级：**bundled < global（`~/.archon/`）< project（`.archon/`）**。同名文件后者覆盖前者。
- 修改默认文件后必须运行 `bun run generate:bundled`，`bun run validate` 会运行 `check:bundled`，如果生成文件 stale 则 CI 失败。
- 用户可通过 `defaults.loadDefaultCommands: false` 或 `defaults.loadDefaultWorkflows: false` 完全 opt-out。

**为什么值得借鉴**：

gxpm 当前的 skill 生成依赖 `bun run gen:skill-docs`，但缺少“编译时嵌入 + 三层覆盖”的机制。每个项目都需要手动安装 skill，不能开箱即用。

**gxpm 落地建议**：

- `bun run gen:skill-docs` 生成 `skills/gxpm/bundled-skills.generated.ts`，将核心 skill 模板编译进 CLI 二进制。
- 加载优先级：`bundled skills` < `~/.gxpm/skills/`（用户全局） < `.gxpm/skills/`（项目级）。
- `gxpm check` 增加 `--bundled` 检查，确保 generated 文件与模板源码一致。
- 新增 host 或修改 phase gate 时，运行 `gen:skill-docs` 后 `git diff --exit-code` 验证无漂移。

---

## 落地优先级矩阵

| 实践 | 实施难度 | 对 gxpm 价值 | 建议迭代 |
|------|----------|-------------|----------|
| DAG Executor | 高 | 极高 | V0.5（执行引擎升级） |
| Isolation Resolver | 中 | 极高 | V0.3（workspace runtime 完善） |
| 错误分类与韧性 | 低 | 高 | V0.2（capability contract 补充） |
| 变量替换与数据流 | 低 | 高 | V0.2（skill 模板增强） |
| Session 不可变链 | 低 | 中 | V0.2（checkpoint 改进） |
| 事件驱动可观测性 | 中 | 高 | V0.4（Web UI / SSE 准备） |
| PR 模板对抗性治理 | 低 | 高 | V0.2（ship-readiness schema 收紧） |
| Worktree 端口分配 | 低 | 中 | V0.3（workspace metadata 扩展） |
| 零 SDK 契约层 | 中 | 极高 | V0.3（host adapter 重构） |
| Bundled Defaults | 中 | 高 | V0.3（skill 分发体系） |

**首期建议（V0.2-V0.3 可落地）**：错误分类、变量替换、PR 模板治理、Session 不可变链。这四项改动范围小、不触及架构，但能立即提升执行韧性和产物质量。

**中期目标（V0.4-V0.5）**：DAG Executor、Isolation Resolver、事件总线、零 SDK 契约层。这四项是 gxpm 从“状态管理工具”进化为“执行引擎”的结构升级。

Archon 不应被整体 vendoring，而应被拆成以下 capability source：

- **workflow-engine**：DAG 执行、节点类型扩展、变量替换、event-emitter
- **isolation-runtime**：worktree 创建/清理/复用、端口分配、错误分类
- **artifact-evidence-store**：run-scoped 产物路径、证据分层、不可入 git 约束
- **platform-adapter**：Slack/Telegram/GitHub/Discord/Web 的统一 conversation 接口
- **provider-abstraction**：`IAgentProvider` 窄接口、model 验证委托给 SDK 的策略
- **rollback-first-governance**：PR template 的 Security/Blast Radius/Rollback Plan 字段
