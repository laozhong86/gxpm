---
name: gxpm-autopilot
type: reference
description: 开启 gxpm 自动驾驶模式。使用 Autopilot Grant 持久化用户授权，让代理在授权 profile 内自主完成 issue delivery。
---
<!-- AUTO-GENERATED from SKILL.md.tmpl - do not edit directly -->

**Announce at start:** "I am using the gxpm-autopilot skill to persist a user-issued autopilot grant for an issue so the agent can self-drive through allowed actions until a hard stop."

## Host Preamble

Target host: OpenAI Codex CLI.

```bash
GXPM_ROOT="${GXPM_ROOT:-$PWD}"
GXPM_STATE_DIR="${GXPM_STATE_DIR:-$GXPM_ROOT/.gxpm}"
export GXPM_ROOT GXPM_STATE_DIR
```

# gxpm Autopilot

## When to trigger（入口条件）

**何时触发**
- 用户明确要求"自动驾驶模式"。
- 用户选择 autopilot command prompt。
- 用户授权代理不再逐步确认而完成整个 gxpm 工作流。
- 用户说"全程交给你"、"不需要确认"等类似 utterance。

**前置条件**
- 需要 issue（已有 issue ID，或通过 `--auto-id` 新建）。
- 用户已明确授权代理自主行动。

**Skill 边界（什么情况下应该加载别的 skill）**
- Hard stop 出现且需要专项分析时 → `/gxpm-diagnose`、 `/gxpm-debug-issue`、 `/gxpm-grill`
- 仅需要单阶段操作（如只写 plan 或只 review） → 使用对应专项 skill，不启动 autopilot
- 用户未明确授权 → 不加载此 skill，按常规逐步确认推进

## 可操作流程

### 启动

若用户已给出 issue：

```bash
gxpm autopilot start <issue-id> --profile full-delivery --prompt "<user prompt>"
gxpm issue status <issue-id>
gxpm issue next <issue-id>
```

若用户只给任务，没有 issue：

```bash
gxpm autopilot start --auto-id --profile full-delivery --prompt "<user prompt>"
gxpm issue list
```

随后按 `gxpm issue next <issue-id>` 推进。不要停在"我可以继续"的确认话术里。

### 授权边界

`full-delivery` 授权以下动作：

- 创建/推进 issue phases
- 写入和更新 gxpm artifacts
- 创建或使用 worktree
- 修改代码和文档
- 运行本地验证、lint、测试、浏览器 QA
- 创建 commit、push branch、创建或更新 PR
- 在验证通过后 merge/land
- land 后执行 cleanup

### 核心原则

Autopilot 的核心不是跳过治理，而是把用户授权落到 `autopilot-grant` artifact。active grant 允许代理在 profile 范围内自主规划、实施、验证、开 PR、merge/land 和清理；phase gate、artifact、验证证据仍然必须完整保留。

### 命令

```bash
gxpm autopilot status <issue-id>
gxpm autopilot list
gxpm autopilot stop <issue-id> --reason "<reason>"
```

## Red Flags（红旗清单 / 反模式）

- **STOP：用户明确停止或撤销授权。** 立即停止，写入阻塞原因到当前阶段 artifact。
- **STOP：需要密钥、账号登录、付费外部 API 或用户私密输入。** 先写入阻塞原因，停止自动驾驶。
- **STOP：涉及生产数据、破坏性迁移或无法自动回滚的操作。** 必须 human-in-the-loop。
- **STOP：merge conflict、验证失败或安全/权限边界无法自主解决。** 停止并记录。
- **STOP：当前 repo 明确规则与 Autopilot Grant 冲突。** 遵守 repo 规则，停止自动驾驶。
- **STOP：在 allowed actions 内反复询问用户确认。** active grant 的含义就是无需反复确认；只在 hard stop 时停止。
- **STOP：不要将 autopilot 视为跳过阶段门。** phase gate、artifact、验证证据仍然必须完整保留。
- **STOP：`stop_hook_active` 已经为 true 时不再重复阻止。** 避免无限循环。
- **危险信号：** 用户未授权不可逆操作却试图 merge/land → 拒绝并请求显式授权。

## Verification（验证清单 / 出口条件）

- [ ] `autopilot-grant` artifact 已持久化（含 issue、profile、prompt）。
- [ ] `gxpm issue status` 和 `gxpm issue next` 已执行。
- [ ] 各阶段 artifact、phase gate、验证证据完整保留（与 manual 模式一致）。
- [ ] Hard stop 时阻塞原因已写入当前阶段 artifact。
- [ ] 到达 terminal phase（land + cleanup 完成）或用户停止/撤销时正常结束。
- [ ] `gxpm autopilot stop` 已调用并记录 reason。

**失败时路由**
- 调试/验证失败 → `/gxpm-diagnose` 或 `/gxpm-debug-issue`
- 需求/架构决策受阻 → `/gxpm-grill`
- 代码审查问题 → `/gxpm-review-changes`
- 安全/权限问题 → 停止 autopilot，等待 human-in-the-loop

## 常见说辞表

| 用户 utterance | 推荐回应 |
|----------------|----------|
| "全程交给你，不用确认。" | 启动 `gxpm autopilot start --auto-id --profile full-delivery --prompt "..."`，然后按 `gxpm issue next` 推进。 |
| "帮我自动驾驶 GXPM-42。" | 启动 `gxpm autopilot start GXPM-42 --profile full-delivery --prompt "..."`，然后按 `gxpm issue next` 推进。 |
| "可以停了。" / "暂停 autopilot" | `gxpm autopilot stop <issue-id> --reason "User requested pause"`，报告当前阶段和已产出 artifact。 |
| "autopilot 到哪了？" | `gxpm autopilot status <issue-id>`，结合 `gxpm issue status` 汇报当前阶段和 next 推荐。 |

## Read Next

- `/gxpm` — main project management runtime
- `docs/governance/development-contract.md`
