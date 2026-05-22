# gxpm

> **AI Agent 工作制度架构 + 工作流 + 状态机的可执行产品**
>
> 形态：基于文档驱动的制度套件 + CLI 运行时

gxpm 是给 AI Agent 建立的一套**"公司制操作系统"**：以 Markdown/JSON 文档承载治理规则与角色契约，以 CLI 运行时解析执行这些规则，驱动 Agent 在严格状态机中按 phase 交付，最终以 commit 切分阶段边界，以 skill 注入专业能力，将所有证据与事实持久化到本地文件系统，实现可审计、可中断、可恢复的全自动 issue 交付闭环。

它面向完全替代 PMC 和 gstack，会系统吸收两者已验证有效的能力，然后重构成统一的原生产品：

- 从 PMC 继承 Linear-first 项目管理、issue phase、状态门禁、交付产物和可恢复执行。
- 从 gstack 继承技能框架、浏览器 runtime、QA/review/ship/investigate 流水线、上下文恢复、自学习和团队化安装。
- 在 gxpm 中重新定义统一的 state graph、capability runtime、agent execution loop、browser evidence layer 和 release governance。

它不是 PMC 的兼容壳，也不是 gstack 的插件集合。所有设计都服务于**独立产品闭环**。

---

## 架构哲学

### 四维分工

| 维度 | 职责 | 在 gxpm 中的体现 |
|---|---|---|
| **commit** | 阶段切分 | git worktree 隔离 + phase transition，物理与逻辑双重边界 |
| **Agent** | 角色分工 | triage/plan/implement/review/QA/land owner，责任视角而非人格模板 |
| **skill** | 能力注入 | `skills/*/SKILL.md` 可发现、可加载、可校验的方法目录 |
| **证据/事实** | 持久存储 | `artifacts/*.json` + `evidence/` + `state.json`，本地文件系统为唯一真值 |

### 五层架构

```
L1: 制度文档层 (Document Governance)
    CANON.md / AGENTS.md / CONTEXT.md / docs/governance/*.md
    ── 定义不可破坏的规则、术语、开发合同、架构决策

L2: 角色与技能层 (Agent & Skill Surface)
    agents/*.md / skills/*/SKILL.md / templates/*.tmpl
    ── Agent 是责任视角，Skill 是可加载能力，均通过文档声明契约

L3: 工作流编排层 (Workflow Orchestration)
    workflows/*.yml / core/phase-gates.ts / PHASE_GATE_RULES
    ── 12-phase pipeline，每步有输入 artifact、输出 artifact、gate 规则

L4: 状态机执行层 (State Machine Runtime)
    core/state.ts / core/capabilities.ts / CLI commands
    ── 强制执行 transition 顺序，检查 worktree/artifact gate，写事件日志

L5: 证据与恢复层 (Evidence & Recovery Store)
    .gxpm/issues/<id>/{state,artifacts,evidence,memory}/
    ── 文件系统为唯一真值，支持新会话零上下文恢复
```

### 核心原则

1. **文档即制度，制度可执行** —— 治理规则以文本形式存在，被 CLI 解析、被模板引擎生成、被 hook 校验、被 Agent 加载。
2. **本地 state 永远比外部系统更权威** —— phase JSON artifact 比 markdown report 更权威；`state.json` 比 Linear comment、PR body、聊天上下文更权威。
3. **所有 transition 都必须可审计、可重放、可恢复** —— 事件 append-only 写入 `events.jsonl`，`graph.json` 记录完整 transition 历史。
4. **Command 只路由，Agent 只担责，Skill 只注入，Artifact 只存真值** —— 分层边界不可漂移。

---

## 初始化产物

- `AGENTS.md`：本仓库代理规则。
- `CANON.md`：全局行为宪法。
- `CONTEXT.md`：共享语言与领域术语表。
- `package.json`：Bun/TypeScript 脚手架入口。
- `hosts/`：Codex 与 Claude Code 的 host adapter 注册。
- `scripts/`：skill 模板发现、生成和脚手架检查。
- `bin/`：未来安装/升级/检查命令的稳定入口。
- `docs/governance/`：代理开发规范、模板写法和 host adapter 治理。
- `docs/research/pmc-gstack-skill-study.md`：PMC 与 gstack 的调查结论。
- `docs/architecture/gxpm-replacement-architecture.md`：替代型二代架构。
- `docs/architecture/gxpm-v0-contract.md`：gxpm V0 合同与边界。
- `docs/architecture/layered-workflow-boundaries.md`：分层工作流边界。
- `docs/architecture/scaffold-northstar.md`：借鉴 gstack 的脚手架北极星。
- `docs/roadmap/initial-roadmap.md`：初始路线图。
- `skills/gxpm/SKILL.md.tmpl`：gxpm skill 模板真值。
- `skills/gxpm/SKILL.md`：由模板生成的 gxpm skill 入口。

---

## 快速开始

```bash
git clone https://github.com/laozhong86/gxpm.git ~/gxpm && cd ~/gxpm
bun install && bun link

cd /path/to/your/project
gxpm init                      # 初始化项目（hooks + skills + config）
gxpm doctor --json             # 健康检查
gxpm verify                    # 端到端验证
```

`gxpm init` 会在目标仓库 `package.json` 的 `scripts` 区块幂等注入两条 GitNexus 索引入口：

- `nexus` → `gitnexus analyze --skip-agents-md`（日常索引，不修改 `AGENTS.md` / `CLAUDE.md` 的 gitnexus 区块）
- `nexus:full` → `gitnexus analyze`（包含文档统计回写的完整索引）

若目标仓库已存在自定义 `scripts.nexus`，安装流程会跳过不覆盖。仓库无 `package.json` 时静默通过。可用 `gxpm init --skip-nexus-script` 关闭这一行为。

Agent 自举协议见 `docs/INSTALL_FOR_AGENTS.md`。

---

## 本地命令

```bash
bun test
bun run gen:skill-docs
bun run check

gxpm issue create --auto-id
gxpm issue status <id>
gxpm doctor --fix
gxpm upgrade
gxpm verify

bin/gxpm workspace plan local-demo
bin/gxpm run list local-demo
bin/gxpm orchestrator tick --dry-run
bin/gxpm artifact list local-demo
bin/gxpm artifact read local-demo acceptance-contract
```

完整 phase gate 命令由 `skills/gxpm/SKILL.md` 生成，真值来自 `core/phase-gates.ts`。

---

## 行为规范参考框架

gxpm 的分层架构设计直接继承并转译自 [ZeroZ-lab/unified-skills](https://github.com/ZeroZ-lab/unified-skills) 的四层分离制度：

| 层 | unified-skills | gxpm |
|---|---|---|
| 宪法 | CANON.md（10 条行为宪法） | CANON.md（10 条行为宪法） |
| 阶段协议 | 12 个 Command（/refine /plan /build /review /ship） | 12-phase state machine + CLI commands |
| 角色责任 | 24 个 Agent（7 核心 + 17 审查/侦察） | `agents/*.md` + future Agent Runtime |
| 能力注入 | 53 个 Skill（SKILL.md） | `skills/*/SKILL.md`（host-facing） |
| 产物链 | `docs/features/YYYYMMDD-<name>/` | `.gxpm/issues/<id>/artifacts/*.json` |
| 治理检查 | `./validate` | `bun run check` + `scripts/scaffold-check.ts` |

unified-skills 是 gxpm 的**上游行为规范来源**，不是运行时依赖。gxpm 吸收其分层原则和纪律设计，但用 state graph + capability runtime + evidence store 重新实现为可执行产品。

本地参考路径：`/Users/x/Desktop/Project/github/unified-skills`

## 当前边界

当前已具备脚手架、host adapter、生成检查、`.gxpm` state graph、phase artifact gate、checkpoint/resume、原生 wiki init/update/query/context/eval，以及第一批 execution runtime 原语：run ledger、workspace runtime 和只读 orchestrator dry-run。下一步应继续把 PMC/gstack 能力拆成 gxpm 原生模块，并围绕 V0 最小替代闭环补齐真实 agent run、browser evidence 和 release governance。
