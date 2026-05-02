# oh-my-codex 工程实践研究报告

> 研究日期：2026-05-02
> 来源：Yeachan-Heo/oh-my-codex（本地路径 `/Users/x/Desktop/Project/github/oh-my-codex`）
> 研究目的：提取对 gxpm 有参考价值的工程实践，建立快速适配索引

---

## 一、项目定位

**oh-my-codex（OMX）** 是一个基于 OpenAI Codex CLI 的**工作流编排层**，不自建执行引擎，而是通过 hooks、skills、state 管理和 tmux 运行时来增强 Codex 的默认体验。

核心定位："better task routing + better workflow + better runtime"。OMX 在 Codex CLI 之上构建了一个完整的代理项目管理工作流，包含需求澄清、计划生成、团队并行执行、持久化完成循环等阶段。

---

## 二、架构与目录结构

```
oh-my-codex/
├── src/
│   ├── cli/          # CLI 命令入口（omx.ts → index.ts）
│   ├── config/       # 配置解析：Codex hooks、模型路由、MCP registry
│   ├── hooks/        # 生命周期钩子：keyword-detector、session、agents-overlay
│   ├── modes/        # 工作流模式基类：startMode/updateMode/cancelMode
│   ├── state/        # 状态机：workflow-transition、skill-active、reconcile
│   ├── runtime/      # 执行循环：run-loop、run-outcome、terminal-lifecycle
│   ├── team/         # 团队并行运行时：orchestrator、tmux-session、worktree、state
│   ├── ralph/        # 持久化完成循环：persistence、contract
│   ├── pipeline/     # 流水线阶段
│   ├── mcp/          # MCP 服务器实现（state-server、trace-server）
│   ├── agents/       # 原生代理配置生成
│   ├── hud/          # Heads-up display 状态
│   └── utils/        # 路径解析、AGENTS.md 工具
├── skills/           # SKILL.md 技能定义（ralph、team、autopilot、deep-interview 等）
├── prompts/          # 角色提示词（analyst、architect、executor 等 30+ 角色）
├── templates/        # 模型指令模板
├── plugins/          # Codex 官方插件打包（含 marketplace.json）
├── crates/           # Rust 子 crate（runtime-core、explore、mux、sparkshell）
└── docs/             # 详尽文档（contracts、reference、release-notes、状态模型）
```

**关键架构决策**：
- **双层状态存储**：`.omx/state/<mode>-state.json`（权威）+ `skill-active-state.json`（兼容/可见层）
- **Session 作用域优先**：session-scoped state > current session > root scope fallback
- **混合语言运行时**：TS 负责编排与 CLI，Rust 负责高性能探索和 runtime 桥接
- **Codex 插件 + 原生 Hooks 双轨**：既有 `.codex/hooks.json` 原生 hook，也有 OMX plugin hooks

---

## 三、核心功能模块

| 模块 | 职责 | gxpm 映射参考 |
|------|------|---------------|
| **cli/omx.ts** | CLI 入口，处理 `main(argv)` | `bin/gxpm` 系列脚本 |
| **config/** | 解析 `.omx-config.json`、Codex `config.toml`、模型路由 | `core/config.ts` |
| **hooks/** | `UserPromptSubmit` 关键词检测、`SessionStart` 上下文注入、`Stop` 续行判断 | `.githooks/` 和 host adapter |
| **modes/base.ts** | 统一模式生命周期：start → update → cancel | gxpm phase gate |
| **state/** | 工作流过渡决策、协调同步 | gxpm issue state graph |
| **runtime/** | 通用执行循环、结果分类 | gxpm implement/execute loop |
| **team/** | tmux 多窗格并行工作器、任务分解、worktree 隔离 | gxpm（未来）并行执行层 |
| **ralph/** | 持久化完成循环：进度台账、PRD 迁移、视觉校验门 | gxpm implement → verify → land |
| **mcp/** | 暴露 `omx_state.*` 工具给 Codex/MCP 客户端 | gxpm capability runtime |
| **agents/** | 原生 Codex Agent TOML 生成（30+ 角色定义） | gxpm skills/hosts |

---

## 四、技术栈

- **Node.js 20+ + TypeScript**：主运行时与编排
- **Rust**：辅助运行时（`omx-explore`、`omx-mux`、`omx-runtime-core`、`omx-sparkshell`）
- **Cargo**：构建 Native 代理/探索 harness
- **tmux**：macOS/Linux 团队并行执行的基础设施
- **MCP (Model Context Protocol)**：状态读写、wiki、trace 等服务器能力

---

## 五、Codex CLI 工作流设计

### 5.1 Native Hook 映射矩阵

| Codex Hook | OMX 处理 | 状态 |
|-----------|---------|------|
| `SessionStart` | 刷新 session bookkeeping、注入 wiki 上下文、恢复开发者上下文 | native |
| `UserPromptSubmit` | 关键词检测（`$ralph`/`$team`/`$ralplan`）、状态种子、triage 路由 | native |
| `PreToolUse` (Bash) | `rm -rf` 警告、内联 `git commit` 拦截、文档刷新警告 | native-partial |
| `PostToolUse` (Bash) | 命令失败/权限错误指引、MCP 传输死亡检测 | native-partial |
| `Stop` | Ralph/Team/Autopilot 续行判断、auto-nudge、生命周期元数据 | native-partial |

**关键设计**：`.codex/hooks.json` 是**共享所有权文件** —— OMX 只刷新自己管理的 wrapper 条目，保留用户自定义 hook。`omx uninstall` 也只移除 OMX 管理的部分。

### 5.2 标准工作流（Canonical Workflow）

```
$deep-interview → $ralplan → ($team | $ralph)
```

- **deep-interview**：澄清需求、边界、非目标
- **ralplan**：生成并审批实现计划
- **team**：tmux 并行执行（适合大任务）
- **ralph**：持久化单所有者完成循环（适合需要保证完成的场景）

### 5.3 关键词检测与状态种子

`src/hooks/keyword-detector.ts` 是工作流路由的核心：
- 检测 `$skill` 关键词并排序
- 记录 `skill-active-state.json`
- 对 `$ralph` 只做**状态种子**，不启动 CLI 进程
- 多关键词支持：`$ralplan $team $ralph` 会延迟执行技能，保留 planning 为当前主模式

### 5.4 插件 Hooks 扩展点

- 用户可在 `.omx/hooks/*.mjs` 编写插件
- 暴露事件：`session-start`、`keyword-detector`、`pre-tool-use`、`post-tool-use`、`stop`、`session-end`、`turn-complete`、`session-idle`
- SDK 提供：`sdk.state.read/write`（插件命名空间隔离）、`sdk.tmux.sendKeys`、`sdk.log.info/warn/error`

---

## 六、配置系统与扩展点

### 6.1 三层配置来源

1. **Shell 环境变量**（最高优先级）：`OMX_DEFAULT_FRONTIER_MODEL`、`OMX_DEFAULT_STANDARD_MODEL`
2. **`.omx-config.json`**：用户级（`~/.codex/`）或项目级（`./.codex/`）
3. **Codex `config.toml`**：读取 root model、provider、model_providers

### 6.2 模型路由解析链

```
mode-specific > models.default > OMX_DEFAULT_FRONTIER_MODEL > config.toml model > built-in default (gpt-5.5)
```

- 团队低复杂度 worker：`team_low_complexity` 别名支持三种 key 风格（snake/kebab/camel）
- **显式规则**：禁止从模型名称子串推断 reasoning effort

### 6.3 扩展点

| 扩展点 | 机制 | 位置 |
|--------|------|------|
| **Skills** | SKILL.md + frontmatter | `skills/`（项目级）或 `~/.codex/skills/`（用户级） |
| **Prompts** | Markdown 角色定义 | `prompts/` |
| **Native Agents** | TOML 生成 | `.codex/agents/` |
| **Plugin Hooks** | ES Module 导出 `onHookEvent` | `.omx/hooks/*.mjs` |
| **MCP Servers** | 通过 `.mcp.json` / `config.toml` 注册 | `config/mcp-registry.ts` |
| **Wiki** | Markdown-first、搜索优先 | `.omx/wiki/` |

### 6.4 AGENTS.md 合并策略

- `omx setup --merge-agents` 在现有 `AGENTS.md` 中插入 OMX 生成区块
- 使用 `<!-- OMX:AGENTS:START -->` / `<!-- OMX:AGENTS:END -->` 标记
- 非交互式 setup 默认跳过已有 `AGENTS.md`（避免覆盖用户定制）

---

## 七、Agent 执行循环与状态管理

### 7.1 状态模型（Explicit Terminal Stop Model）

生命周期结果：`finished` / `blocked` / `failed` / `userinterlude` / `askuserQuestion`

**读取优先级**：
1. `lifecycle_outcome`（规范生命周期元数据）
2. 遗留 `run_outcome`
3. 从 `current_phase` 推断

### 7.2 工作流过渡规则（Workflow Transition）

`src/state/workflow-transition.ts` 实现了严格的状态机：

| 源模式 | 目标模式 | 结果 |
|--------|---------|------|
| deep-interview | ralplan | auto-complete 源模式 |
| ralplan | team / ralph / autopilot | auto-complete 源模式 |
| team | ralph | overlap（共存） |
| ralph | team | overlap（共存） |
| execution → planning | — | **deny**（禁止回滚） |

**关键不变量**：
- 执行类模式回滚到规划类模式永远不允许自动完成
- 未在白名单中的过渡默认拒绝
- native-hook 输出是展示层，不是独立决策引擎

### 7.3 通用执行循环（Run Loop）

`src/runtime/run-loop.ts` 提供 `runUntilTerminal(step, options)`：
- 每次迭代返回 `{ outcome, state }`
- 结果分类：`progress` / `continue`（非终端） vs `finish` / `blocked_on_user` / `failed` / `cancelled`（终端）
- 支持 `maxIterations` 和 `onIteration` 回调
- 标准化别名映射：`done` → `finish`, `error` → `failed`, `abort` → `cancelled`

### 7.4 Team 并行运行时

**阶段管道**：`team-plan` → `team-prd` → `team-exec` → `team-verify` → `team-fix`（循环）→ `complete`/`failed`

**基础设施**：
- **tmux**：leader 窗格 + worker 窗格分割
- **worktree**：每个 worker 可运行在独立 git worktree（`--worktree`）
- **Mailbox**：`.omx/state/team/<team>/mailbox/leader-fixed.json` 进行 leader-worker 通信
- **Dispatch Request**：任务分派状态机（pending → notified → delivered → integrated）
- **Worker CLI 多态**：支持 Codex 或 Claude CLI 作为 worker（`OMX_TEAM_WORKER_CLI`）

### 7.5 Ralph 持久化循环

- **Context Snapshot**：`.omx/context/{task-slug}-{timestamp}.md` 强制 grounding
- **Progress Ledger**：`.omx/state/ralph-progress.json` 记录迭代、视觉反馈
- **PRD 模式**：`--prd` 先初始化产品需求文档
- **完成门控**：
  1. 零 pending TODO
  2. 新鲜测试/构建通过
  3. Architect 验证（STANDARD tier 起）
  4. AI-slop-cleaner 清理
  5. 回归重验证

---

## 八、对 gxpm 的借鉴价值

### 8.1 可直接复用的模式 ✅

| # | 模式 | 具体借鉴方式 |
|---|------|-------------|
| 1 | **显式终端停止模型** | gxpm phase gate 可引入 `lifecycle_outcome` 规范层，替代单一 `phase` 推断 |
| 2 | **工作流过渡白名单** | gxpm issue 的 phase 推进可引入 `evaluateWorkflowTransition`，防止非法回滚 |
| 3 | **Session 作用域状态隔离** | gxpm 的 `.gxpm/issues/<id>/` 可进一步引入 `session-scoped state` 优先于 `root scope` |
| 4 | **共享所有权配置** | `.codex/hooks.json` 的共享所有权设计可直接用于 gxpm 的 `.githooks/` |
| 5 | **AGENTS.md 合并标记** | `<!-- OMX:AGENTS:START/END -->` 的区块合并策略比全文件覆盖更安全 |
| 6 | **模型路由解析链** | gxpm host adapter 可引入 `mode-specific > default > env > built-in` 的模型选择链 |
| 7 | **Context Snapshot 强制门控** | Ralph 的 context snapshot 可移植到 gxpm 的 `dispatch→implement` 阶段 |
| 8 | **Run Loop 抽象** | `runUntilTerminal(step)` 的通用循环可封装为 gxpm capability runtime 的基础执行原语 |
| 9 | **MCP 状态服务器** | `omx_state.*` MCP 工具将状态读写暴露给 agent，gxpm 可将 artifact 读写封装为 MCP tools |
| 10 | **Skill frontmatter 元数据** | `--- name: ralph description: ... ---` 的标准化 SKILL.md 头部可被 gxpm skills 采用 |

### 8.2 应避免的陷阱 ❌

| # | 陷阱 | 原因 | gxpm 应对建议 |
|---|------|------|---------------|
| 1 | **过度依赖 tmux** | 强绑定 tmux，Windows/WSL 体验降级、测试复杂 | 优先考虑原生 subagent/MCP 并行，tmux 仅作为可选后端 |
| 2 | **双层状态同步风险** | `mode-state.json` + `skill-active-state.json` 多次导致 "ghost state" | 坚持**单一真相源**（`.gxpm/issues/<id>/`），若需兼容层则引入显式协调 helper |
| 3 | **Hooks fallback 矩阵过复杂** | native/native-partial/runtime-fallback/not-supported-yet 四级，调试困难 | 优先走**原生 host adapter 扩展点**，减少 fallback 层 |
| 4 | **Rust/TS 混合构建复杂度** | 需要 Cargo + Node 双构建链，测试和发布流程重 | gxpm 当前纯 TS/Bun 是优势，Rust 引入需有明确性能诉求 |
| 5 | **进程级 worker 过重** | 每个 worker 是完整 Codex/Claude CLI 进程，启动慢、资源消耗大 | 使用**轻量级 task delegation** 而非完整进程复制 |
| 6 | **Setup 副作用过多** | `omx setup` 修改多处位置，回滚复杂 | `gxpm-init` 应更模块化，支持 dry-run 和 scope 选择 |
| 7 | **Prompt 路由的隐性状态** | `keyword-detector` + `triage-heuristic` 在 prompt submit 时注入路由上下文 | gxpm 应让**issue id 显式驱动路由**，避免隐式分类干扰 |

---

## 九、关键文件映射

| OMX 文件路径 | 内容 | gxpm 对应 |
|-------------|------|-----------|
| `docs/STATE_MODEL.md` | 状态权威、过渡规则、审计字段 | `docs/architecture/gxpm-v0-contract.md` |
| `docs/codex-native-hooks.md` | 原生 hook 映射矩阵 | `docs/governance/host-adapter.md` |
| `docs/hooks-extension.md` | 插件扩展点、SDK 接口 | `hosts/codex.ts` 扩展设计 |
| `src/state/workflow-transition.ts` | 工作流过渡决策引擎 | `core/gate.ts` |
| `src/modes/base.ts` | 统一模式生命周期 | `core/dispatch.ts` |
| `src/runtime/run-loop.ts` | 通用终端执行循环 | capability runtime 执行原语 |
| `src/team/orchestrator.ts` | Team 阶段管道 | 未来并行执行层参考 |
| `src/team/runtime.ts` | Team tmux 运行时、worktree、mailbox | `core/worktree.ts`（如存在） |
| `src/config/models.ts` | 模型路由解析链 | `hosts/` 模型选择逻辑 |
| `src/hooks/keyword-detector.ts` | 关键词检测与状态种子 | `core/command-probe.ts` |
| `skills/ralph/SKILL.md` | 持久化完成循环的完整契约 | `skills/gxpm/` 系列 |
| `skills/team/SKILL.md` | 团队并行执行的完整契约 | 未来并行执行层参考 |

---

## 十、适配建议

1. **生命周期模型规范化**：在 gxpm 的 phase gate 中引入 `lifecycle_outcome` 规范层（`finished`/`blocked`/`failed`/`cancelled`），替代单一的 `phase` 字符串推断，增强跨会话恢复能力。
2. **工作流过渡规则**：引入 `evaluateWorkflowTransition` 白名单机制，明确允许和禁止的 phase 转换（如 `qa→implement` 禁止自动完成）。
3. **AGENTS.md 合并策略**：`gxpm-init` 采用标记式合并（`<!-- GXPM:AGENTS:START/END -->`），避免覆盖用户已有定制。
4. **模型路由链**：host adapter 引入 `mode-specific > default > env > built-in` 的模型选择链，支持 per-skill/per-phase 模型降级。
5. **MCP 状态暴露**：将 `.gxpm/issues/<id>/` 的 artifact 读写封装为 MCP tools（如 `gxpm_state.read`、`gxpm_state.write`），实现 agent 自托管状态。
6. **Context Snapshot**：在 `dispatch→implement` 阶段要求 agent 完成上下文快照（`.gxpm/issues/<id>/context-snapshot.md`），强制 grounding。

---

## 十一、一句话总结

> oh-my-codex 在**工作流过渡规则、显式生命周期模型、配置分层解析、共享所有权 hook、AGENTS.md 合并策略**方面提供了非常成熟的参考实现，建议 gxpm 在 capability runtime 和 phase gate 设计中重点吸收；同时，OMX 作为 Codex wrapper 的某些复杂兼容层（双层状态、tmux 进程级并行）在 gxpm 的独立产品定位下可以简化或避免。
