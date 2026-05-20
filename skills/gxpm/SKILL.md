---
name: gxpm
description: Second-generation agent project management runtime. Use when user mentions gxpm, issue phases, worktrees, artifacts, checkpoint recovery, or asks about project management workflow.
---
<!-- AUTO-GENERATED from SKILL.md.tmpl - do not edit directly -->

## Host Preamble

Target host: OpenAI Codex CLI.

```bash
GXPM_ROOT="${GXPM_ROOT:-$PWD}"
GXPM_STATE_DIR="${GXPM_STATE_DIR:-$GXPM_ROOT/.gxpm}"
export GXPM_ROOT GXPM_STATE_DIR
```

# gxpm

gxpm 是面向代理执行的统一项目管理运行时。
产品目标是替代 PMC 和 gstack，以原生状态图、能力运行时和阶段门控推进 —— 不是包装它们。

## 入口条件

**何时触发**
- 用户提到 gxpm、issue phases、worktrees、artifacts、checkpoint recovery。
- 用户询问项目管理 workflow、阶段推进、或 issue 生命周期。
- 任何涉及 `.gxpm/issues/<id>/` 状态或 artifact 的操作。

**前置条件**
- 无特殊前置；如状态不存在，先创建：`gxpm issue create --auto-id`。

**Skill 边界（什么情况下应该加载别的 skill）**
- 纪律性调试循环 → `/gxpm-diagnose`
- 对齐会议、术语精炼 → `/gxpm-grill`
- 垂直切片测试驱动开发 → `/gxpm-tdd`
- 架构摩擦分析 → `/gxpm-architecture`
- PRD 合成与垂直切片拆分 → `/gxpm-planning`
- Issue 状态机管理（分类、标签、路由） → `/gxpm-triage`
- GitNexus 驱动问题调试 → `/gxpm-debug-issue`
- GitNexus 驱动代码探索 → `/gxpm-explore-codebase`
- GitNexus 驱动安全重构 → `/gxpm-refactor-safely`
- GitNexus 驱动变更审查 → `/gxpm-review-changes`
- 浏览器证据捕获 → `/gxpm-browser`

## 可操作流程

### 速查手册

```bash
gxpm issue status <issue-id>          # 读取当前阶段
gxpm issue next <issue-id>            # 推荐下一步命令（创建 issue 后必须首先执行）
gxpm issue context <issue-id>         # 完整上下文 + 恢复新鲜度 + 必读文件 + 代理指令（新会话续做的首选入口）
gxpm issue list                       # 活跃 issue
gxpm issue create --auto-id           # 使用下一个空闲 id 创建新 issue
gxpm phase rewind <issue-id> --to <phase> --reason "..."  # 回退到已进入过的历史阶段（需显式理由）
gxpm autopilot start <issue-id>|--auto-id --profile full-delivery
gxpm autopilot status <issue-id>
gxpm doctor                           # 健康检查
gxpm version                          # 已安装版本
```

### issue 执行路径（不可绕过）

**创建 issue 后的第一步必须是 `gxpm issue next <issue-id>`。**

Agent 不得自行拼凑 checkpoint、issue-intake 或其他非标准命令来试探阶段路径。`issue next` 是单一真相源，它会告诉你当前阶段、下一步 transition 命令、以及当前阶段可用的 artifact init 命令。

**各阶段 artifact init 映射表：**

| 当前阶段 | 初始化命令 | 产出 artifact |
|----------|-----------|--------------|
| triage | `gxpm triage init <issue-id>` | acceptance-contract |
| plan | `gxpm plan init <issue-id>` | implementation-plan |
| dispatch | `gxpm dispatch init <issue-id>` | dispatch-handoff |
| specify | `gxpm specify init <issue-id>` | behavior-spec |
| implement | `gxpm implement verify <issue-id>` | local-verify |
| local-verify | `gxpm local-verify ac-check <issue-id>` | acceptance-check |
| ac-check | `gxpm ac-check self-review <issue-id>` | self-review |
| self-review | `gxpm self-review cleanup <issue-id>` | cleanup-report |
| cleanup | `gxpm cleanup ship <issue-id>` | ship-readiness |
| ship | `gxpm ship pr-check <issue-id>` | pr-check |
| pr-check | `gxpm pr-check verify <issue-id>` | verify-findings |
| verify | `gxpm verify qa <issue-id>` | qa-findings |
| qa | `gxpm qa land <issue-id>` | land-findings |

**Artifact 写入纪律：**

- 所有 artifact 写入必须通过 CLI：`gxpm artifact write <id> <type> --json ...`、`gxpm artifact edit <id> <type> ...`、或各阶段 `init` 命令。
- **NEVER 直接编辑 `.gxpm/issues/<id>/artifacts/*.json` 文件。** 这违反 CANON 第4条（Artifact 先决）。
- 当 gxpm CLI 缺少某个需要的命令时，**必须停止并报告缺口**，不得绕过命令层直接写文件系统。

### 阶段地图

- `triage`: 澄清 issue、范围、风险、下一阶段。
- `plan`: 产出已批准的实现和验证计划。
- `dispatch`: 创建 worktree/交接/契约。
- `implement`: 工作者拥有的实现。
- `local-verify`: 代理拥有的本地验证证据。
- `ac-check`: 验收契约履行。
- `self-review`: PR 前内部审查。
- `ship`: PR/发布准备。
- `pr-check`: 审查评论和 PR 风险。
- `verify`: 独立验收验证。
- `qa`: 浏览器/运行时证明（如需要）。
- `land`: 合并/部署交接门。

### 状态优先

在做阶段工作前，先读取 `gxpm issue status <issue-id>`。
如果状态不存在，创建它：`gxpm issue create --auto-id`。

### 规范状态位置

`.gxpm/issues/<id>/` 始终位于**主仓库**中，绝不按 worktree 分布。
在 worktree 中工作时，从主仓库 cwd 运行 gxpm 命令，在 worktree 中编辑代码。
不要创建按 worktree 分布的 `.gxpm/` 目录。

### CONTEXT.md 纪律

`CONTEXT.md` 是领域术语的单一真相源。在 `/gxpm-grill` 会话中术语被解决或精炼时内联更新它。
惰性创建 —— 仅在第一个术语需要记录时创建。

### Artifact 纪律

任何非平凡的提议在阶段推进前**必须**写入 artifact。
Artifact 树是真相源；聊天历史是易失的。

当 artifact 负载引用具体 CLI 命令时，使用 `--probe-cli`：

```bash
gxpm artifact write <issue-id> <artifact-type> --probe-cli --json '...'
```

### Autopilot Grant

当用户要求“自动驾驶模式”、选择 gxpm autopilot command prompt，或明确授权代理无需逐步确认完成全流程时，先持久化授权：

```bash
gxpm autopilot start <issue-id>|--auto-id --profile full-delivery --prompt "<user prompt>"
```

`autopilot-grant` 是 issue-local artifact。active grant 表示用户已授权代理在该 issue 和 profile 范围内自主完成 triage、plan、dispatch、implement、verify、review、PR、merge/land 和 cleanup。不要在这些 allowed actions 内反复询问确认；只在 hard stop 出现时停止，并把阻塞原因写入当前阶段 artifact。

常用命令：

```bash
gxpm autopilot status <issue-id>
gxpm autopilot list
gxpm autopilot stop <issue-id> --reason "<reason>"
```

### Worktree 策略

在代码编辑前查询策略：

```bash
gxpm worktree policy
```

解析链：`config.json` → 用户消息 → `AGENTS.md` → 默认 (required, ask)。
当 `enforcement = required` 时：始终创建 worktree。当 `forbidden` 时：绝不。

在 **dispatch** 阶段，在过渡到 implement 前准备工作空间：

```bash
gxpm workspace ensure <issue-id>
```

- 如果创建了或重用了 git worktree，路径会被打印。编辑代码前先 `cd` 进去。
- 如果命令返回普通目录（非 git 仓库），直接使用该目录。
- 当 `enforcement = required` 或 `default = use` 时，将 `gxpm workspace ensure` 视为强制的过渡前步骤。
- 当从 `dispatch → implement` 过渡时，gxpm 自动调用 `ensureIssueWorkspaceWithResolver` 并用产生的 `worktreePath` 和 `worktreeDecision` 更新 `dispatch-handoff` artifact。

### 检查点 / 恢复

保存交接状态：

```bash
gxpm issue checkpoint <issue-id> --title "handoff" --stdin
```

在新会话中恢复（读取最新检查点包）：

```bash
gxpm issue resume <issue-id>
```

带完整上下文 + 新鲜度检查的新会话续做（首选）：

```bash
gxpm issue context <issue-id>
```

此命令返回：
- `confidence`: `fresh`, `stale_resume`, `missing_resume`, 或 `invalid_resume`
- `confidenceReasons`: 恢复包可信任或不可信任的原因
- `requiredReads`: 行动前按顺序读取的文件列表
- `agentInstructions`: 基于可信度的安全下一步指导
- `next`: 推荐的阶段推进命令

当 prompt 提到 issue id（例如"继续 GXPM-42"）时，Codex hook
自动注入 `gxpm issue context` 输出作为额外上下文。

### Codex `update_plan` vs gxpm 阶段

仅在当前 gxpm 阶段内的子任务使用 Codex `update_plan`。
顶层进度始终通过 `gxpm issue transition` 推进。

### Hook 防御

当 skill 内容被卸载时，`gxpm gate` CLI 加上 git hooks 仍然物理上强制执行阶段门。一次性安装：

```bash
gxpm-init --install --target /path/to/repo
```

逃生舱：`GXPM_GATE_DISABLE=1 git commit ...`

### PR 等待状态轮询

当 `ship`、`pr-check` 或 `verify` 步骤正在等待
CodeRabbit、GitHub checks 或可合并性，且代理应保持当前 Codex CLI 回合存活时，使用有界轮询脚本。

```bash
bun run scripts/wait-pr-ready.ts <pr-number-or-url> --timeout-sec 900 --interval-sec 60
```

退出码契约：

- `0`: 审查、检查和合并状态已就绪。在写发现或采取下一阶段行动前重新读取当前 HEAD PR 状态。
- `1`: 被失败的检查、冲突或请求的更改阻塞。将阻塞物写入当前阶段 artifact。
- `124`: 超时或仍在等待。报告最新观察到的状态并干净停止，而不是永远等待。

仅在仓库不需要审批审查决定时使用 `--allow-review-required`。
不要将 hooks 用作唤醒源；hooks 仅在 Codex 生命周期事件后运行。
除非用户已明确授权不可逆操作，或存在覆盖 merge/land 的 active Autopilot Grant，否则不要从成功的轮询中合并或 land。

### Land 后清理

默认：`gxpm cleanup land <issue-id> --execute`。
如果保留 worktree，将 `retainWorktreeReason` 写入 `land-findings`。

### 知识边界

- 将 GitNexus 用作代理代码智能的默认层，用于代码
  理解、调试、重构影响和 PR 审查。
- 将 `gxpm wiki` 视为可选的面向人类的文档表面，用于
  入职和阶段/CLI/治理导向。
- 不要将 wiki 新鲜度用作阶段门。仅在人类请求本地项目文档或刷新这些文档
  本身就是任务时运行 `gxpm wiki init/update/query`。
- `wiki-context` 是非门控支持 artifact；它不替代
  GitNexus 影响/调试/审查证据。

## 红旗清单 / 反模式

- **STOP：绝不从聊天记忆推断阶段。** 始终先读 `gxpm issue status`。创建 issue 后必须先执行 `gxpm issue next <id>`。
- **STOP：绝不跳过 artifact 回写。** 任何非平凡提议在阶段推进前必须写入 artifact。
- **STOP：绝不让 Linear 替代本地状态。** `.gxpm/issues/<id>/` 是单一真相源。
- **STOP：NEVER 直接编辑 `.gxpm/issues/<id>/artifacts/*.json` 文件。** 所有 artifact 操作必须通过 CLI 命令（`gxpm artifact write/edit` 或 phase init）。
- **STOP：当 CLI 存在缺口时，停止并报告，不得绕过命令层直接写文件。**
- **STOP：绝不未经用户明确确认或 active Autopilot Grant 授权就执行不可逆的 land 操作。**
- **STOP：绝不在 worktree 中创建按 worktree 分布的 `.gxpm/` 目录。** 状态始终在主仓库。
- **STOP：不要将 PMC/gstack 视为最终运行时依赖。** 它们是上游参考；优先使用 gxpm 原生能力。
- **STOP：不要硬编码主机假设。** 使用 gxpm 原生能力。
- **STOP：不要将 hooks 用作唤醒源。** Hooks 仅在 Codex 生命周期事件后运行。
- **STOP：不要从成功的轮询中自动 merge/land（除非用户已授权或存在 active Autopilot Grant）。**
- **STOP：不要将 wiki 新鲜度用作阶段门。**
- **危险信号：** `wiki-context` 试图替代 GitNexus 影响/调试/审查证据时拒绝。

## 验证清单 / 出口条件

**各阶段 artifact 要求**
- `triage` → `acceptance-contract`
- `plan` → `implementation-plan`
- `dispatch` → `dispatch-handoff`（含 worktreePath / worktreeDecision）
- `implement` → 代码变更 + commit
- `local-verify` → 测试/构建/浏览器证据 artifact
- `ac-check` → 验收契约履行记录
- `self-review` → review findings artifact
- `ship` → PR / 发布准备 artifact
- `pr-check` → PR 状态 / 审查评论记录
- `verify` → 独立验证证据
- `qa` → 浏览器/运行时证明（如需要）
- `land` → `land-findings`（含 retainWorktreeReason，如保留 worktree）

**失败时路由**
- 调试困难 → `/gxpm-diagnose`
- 需求/术语不清 → `/gxpm-grill`
- 代码问题 → `/gxpm-debug-issue`
- 架构决策 → `/gxpm-architecture`
- PR 审查 → `/gxpm-review-changes`

## 必需习惯

- 绝不从聊天记忆推断阶段。始终先读 `gxpm issue status`。
- 绝不跳过 artifact 回写。任何非平凡提议在阶段推进前必须写入 artifact。
- 绝不让 Linear 替代本地状态。`.gxpm/issues/<id>/` 是单一真相源。

## 关键规则

### 状态优先

在做阶段工作前，先读取 `gxpm issue status <issue-id>`。
如果状态不存在，创建它：`gxpm issue create --auto-id`。

### Artifact 纪律

任何非平凡的提议在阶段推进前**必须**写入 artifact。
Artifact 树是真相源；聊天历史是易失的。

## 相关 Skills

- 纪律性调试循环 → `/gxpm-diagnose`
- 对齐会议、术语精炼 → `/gxpm-grill`
- 垂直切片测试驱动开发 → `/gxpm-tdd`
- 架构摩擦分析 → `/gxpm-architecture`
- PRD 合成与垂直切片拆分 → `/gxpm-planning`
- Issue 状态机管理（分类、标签、路由） → `/gxpm-triage`

## 常见说辞表

| 用户 utterance | 推荐回应 |
|----------------|----------|
| "继续 GXPM-42" | 执行 `gxpm issue context GXPM-42`，按 requiredReads 和 agentInstructions 行动。 |
| "帮我推进这个 issue" | 先 `gxpm issue status <id>`，再 `gxpm issue next <id>`，按输出的推荐步骤执行。禁止自行试探命令。 |
| "自动驾驶模式" | 执行 `gxpm autopilot start <id>|--auto-id --profile full-delivery --prompt "..."`，然后按 `gxpm issue next` 推进。 |
| "这是什么阶段？" | `gxpm issue status <id>`，然后解释当前阶段及下一阶段的入口条件。 |
| "我改了多少？" | 引导到 `gxpm issue context <id>` 或对应阶段的 artifact 审查。 |
| "可以合并了吗？" | 检查当前阶段是否为 `verify`/`qa` 之后，确认 Autopilot Grant 或显式用户授权，再执行 land 操作。 |

## Read Next

- `docs/architecture/gxpm-replacement-architecture.md`
- `docs/architecture/gxpm-v0-contract.md`
- `docs/governance/development-contract.md`
- `CONTEXT.md`
