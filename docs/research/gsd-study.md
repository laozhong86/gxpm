# GSD 调查

日期：2026-05-04

## 调查对象

- GSD (get-shit-done) 主仓库：`/Users/x/Desktop/Project/github/gsd`
- 本地安装路径：通过 `npx get-shit-done-cc@latest` 分发

## GSD 的核心能力

GSD 是一个**元提示框架（meta-prompting framework）**，夹在用户与 AI coding agent 之间，解决长任务执行中的**上下文腐烂（context rot）**问题。它的核心假设是：当 AI 的上下文窗口被累积对话填满后，输出质量会显著下降，因此必须通过多智能体编排 + 文件化状态来对抗这种衰减。

关键事实：

- **Fresh Context Per Agent**：每个被 orchestrator 派生的 agent 都获得一个干净的 200K 上下文窗口，彻底消除上下文腐烂。
- **Thin Orchestrators**：workflow 文件（`get-shit-done/workflows/*.md`）不做重活，只负责加载上下文、派生 specialist agent、收集结果、更新状态。
- **File-Based State**：所有状态保存在 `.planning/` 目录下（Markdown + JSON），无数据库、无服务器、无外部依赖。状态可 survive `/clear`，可提交到 git，可被人类直接阅读。
- **Spec-Driven Pipeline**：`requirements → research → plans → execution → verification` 的严格流水线。
- **33-Agent 架构**：21 个 primary agent + 12 个 advanced/specialized agent，每个 agent 有聚焦角色、受限工具权限和特定产物。
- **两阶段层级路由（v1.40）**：6 个 namespace meta-skill（`gsd-workflow`、`gsd-project`、`gsd-review`、`gsd-context`、`gsd-manage`、`gsd-ideate`）作为第一层路由，把 eager skill listing 的 token 成本从 ~2,150 tokens 降到 ~120 tokens。
- **Checkpoint / Resume 协议**：debug session 有持久化生命周期（`gathering → investigating → fixing → verifying → awaiting_human_verify → resolved`），状态跨会话保留。
- **防御纵深**：plan-checker（执行前验证）、atomic commits（原子提交）、post-execution verifier（目标回溯验证）、UAT（人工最终 gate）。
- **Nyquist Validation**：自动发现测试缺口并生成测试，不修改实现代码。
- **Cross-AI Peer Review**：支持跨模型（Claude / Codex / Gemini 等）的代码评审。
- **多 Runtime 支持**：Claude Code、OpenCode、Gemini CLI、Kilo、Codex、Copilot、Cursor、Windsurf、Antigravity、Augment、Trae、Cline。

## GSD 高价值模块

- `docs/AGENTS.md`：33 个 agent 的完整角色卡，含工具权限矩阵、产物定义和行为约束。
- `docs/ARCHITECTURE.md`：系统架构、设计原则、组件关系、数据流和文件系统布局。
- `docs/FEATURES.md`：124+ 个功能的详细参考，按核心 / 规划 / QA / 上下文工程 / 基础设施分类。
- `docs/COMMANDS.md`：完整命令语法、flags、用例，含 namespace meta-skill 路由表。
- `agents/gsd-*.md`：每个 agent 的独立角色文件，含 YAML frontmatter（name、description、allowed-tools、triggers）。
- `references/`：上下文预算、AI eval 框架、doc 冲突引擎、context7 使用指南等参考文档。
- `gsd-sdk query` / `gsd-tools.cjs`：状态查询 CLI 层，支持 `init.<workflow>`、`state`、`phase`、`roadmap`、`verify`、`intel` 等查询面。
- `.planning/` 文件契约：
  - `PROJECT.md` / `REQUIREMENTS.md` / `ROADMAP.md` / `STATE.md` / `CONTEXT.md`
  - `phases/{N}-*/`：每阶段产物（RESEARCH、PLAN、SUMMARY、VERIFICATION、SECURITY、UI-SPEC、UI-REVIEW）
  - `.planning/intel/`：可查询代码库知识库（JSON + Markdown）
  - `.planning/debug/*.md`：持久化调试会话
- `VERSIONING.md`：Semantic Versioning + npm dist-tag（latest / next）+ hotfix / minor / major 发布工作流。

## GSD 的限制

- **强绑定文件系统状态**：虽然无数据库是优势，但也意味着没有多用户并发或远程状态同步能力。
- **非 Linear-first**：没有 issue tracker 集成的原生状态机，项目状态全靠 `.planning/` 文件和 ROADMAP.md。
- **Agent 数量庞大**：33 个 agent 的维护成本高，skill surface 即使经过 v1.40 的合并（86→59）仍然复杂。
- **CLI 工具层依赖 Node.js/npm**：`gsd-sdk` 和 `gsd-tools.cjs` 需要本地 Node 运行时，对纯 Bun 环境不够友好。
- **Token 成本敏感**：虽然有两阶段路由和 context-window-aware prompt thinning，但多 agent 派生本身会增加总 token 消耗。
- **无持久浏览器 runtime**：QA 能力以代码评审和测试生成为主，缺少像 gstack 那样的长期浏览器 daemon。

## gxpm 的借鉴方向

GSD 最核心的贡献是**对抗上下文腐烂的工程学**：

1. **Fresh Context Per Agent**：gxpm 的长任务执行（如 investigate、browser QA、multi-file refactor）应借鉴 GSD 的“派生 specialist + 干净上下文”模式，而不是让一个 agent 在同一会话里无限累积。
2. **文件化状态与 Checkpoint**：gxpm 的 `.gxpm/issues/<id>/memory/` 和 `resume-packet.json` 应吸收 GSD 的 `.planning/` 文件契约，让状态对人类可读、对 agent 可加载。
3. **Debug Session 生命周期**：GSD 的 `gathering → investigating → fixing → verifying → resolved` 持久化调试流程，可直接映射到 gxpm 的 investigate capability 和 evidence store。
4. **Agent 权限矩阵**：GSD 的“Checkers read-only / Executors have Edit / Researchers have web”的最小权限原则，应成为 gxpm subagent 派生的默认约束。
5. **两阶段路由**：当 gxpm skill 数量膨胀时，GSD 的 namespace meta-skill 模式（6 个路由器替代 86 个平铺 skill）是降低成本的有效参考。
6. **Nyquist Validation**：gxpm 的 `local-verify` / `ac-check` 阶段可引入“测试缺口自动生成”能力，作为验收的补充证据。

GSD 不应被整体 vendoring，而应被拆成以下 capability source：

- **context-recovery**：checkpoint / resume-packet / session state persistence
- **multi-agent-orchestration**：specialist dispatch、fresh context、thin orchestrator 模式
- **spec-driven-pipeline**：requirements → research → plan → execute → verify 的严格阶段
- **debug-lifecycle**：科学调试循环的持久化状态机
