# Codex CLI Hooks 机制研究

> 研究日期：2026-05-04
> 文档来源：https://developers.openai.com/codex/hooks（官方 Hooks 文档）
> 版本：Codex CLI v0.128.0（2026-04-24）
> 状态：Stable（需 feature flag `codex_hooks = true`）

---

## 1. 配置格式与位置

Codex 的 hooks 配置有两种形式：
1. **独立 `hooks.json` 文件**（推荐）
2. **`config.toml` 内联 `[hooks]` 表**

### 配置位置（按优先级）

| 位置 | 作用域 | 可提交到仓库 |
|------|--------|-------------|
| `~/.codex/hooks.json` | 全局所有项目 | ❌ |
| `~/.codex/config.toml` | 全局所有项目 | ❌ |
| `<repo>/.codex/hooks.json` | 单个项目 | ✅（需项目 `.codex/` 被信任） |
| `<repo>/.codex/config.toml` | 单个项目 | ✅（需项目 `.codex/` 被信任） |

**⚠️ 重要**：如果同一层同时存在 `hooks.json` 和内联 `[hooks]`，Codex 会合并两者并在启动时发出警告。建议每层只使用一种表示。

### Feature Flag

Hooks 默认关闭，必须在 `config.toml` 中显式启用：

```toml
[features]
codex_hooks = true
```

Enterprise 管理员的 managed requirements 也可内联定义 hooks。

### JSON 格式（hooks.json）

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume",
        "hooks": [
          {
            "type": "command",
            "command": "python3 ~/.codex/hooks/session_start.py",
            "statusMessage": "Loading session notes"
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "/usr/bin/python3 \"$(git rev-parse --show-toplevel)/.codex/hooks/pre_tool_use_policy.py\"",
            "statusMessage": "Checking Bash command",
            "timeout": 30
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "/usr/bin/python3 \"$(git rev-parse --show-toplevel)/.codex/hooks/post_tool_use_review.py\"",
            "statusMessage": "Reviewing Bash output",
            "timeout": 30
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "/usr/bin/python3 \"$(git rev-parse --show-toplevel)/.codex/hooks/user_prompt_submit.py\""
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "/usr/bin/python3 \"$(git rev-parse --show-toplevel)/.codex/hooks/stop_continue.py\"",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

### TOML 内联格式（config.toml）

```toml
[features]
codex_hooks = true

[[hooks.PreToolUse]]
matcher = "^Bash$"

[[hooks.PreToolUse.hooks]]
type = "command"
command = '/usr/bin/python3 "$(git rev-parse --show-toplevel)/.codex/hooks/pre_tool_use_policy.py"'
timeout = 30
statusMessage = "Checking Bash command"
```

### Enterprise Managed Hooks

```toml
[features]
codex_hooks = true

[hooks]
managed_dir = "/enterprise/hooks"
windows_managed_dir = 'C:\enterprise\hooks'

[[hooks.PreToolUse]]
matcher = "^Bash$"

[[hooks.PreToolUse.hooks]]
type = "command"
command = "python3 /enterprise/hooks/pre_tool_use_policy.py"
timeout = 30
statusMessage = "Checking managed Bash command"
```

- `managed_dir`：macOS/Linux 管理脚本目录
- `windows_managed_dir`：Windows 管理脚本目录
- 脚本不由 Codex 分发，需企业通过 MDM 等工具单独安装

---

## 2. 事件类型（6 种）

Codex 当前支持 **6 个生命周期事件**，比 Claude Code 少但覆盖了核心场景：

| 事件 | 触发时机 | Matcher 支持 | 可 Block | 引入版本 |
|------|---------|-------------|---------|---------|
| `SessionStart` | 会话开始或恢复 | ✅ `source` 过滤 | ❌ | v0.114.0 |
| `PreToolUse` | 工具调用执行前 | ✅ tool name | ✅ | v0.114.0+ |
| `PermissionRequest` | 需要用户审批时 | ✅ tool name | ✅ | v0.114.0+ |
| `PostToolUse` | 工具调用完成后 | ✅ tool name | ⚠️（不撤销） | v0.114.0+ |
| `UserPromptSubmit` | 用户提交 prompt 前 | ❌ | ✅ | v0.116.0 |
| `Stop` | 一轮响应完成时 | ❌ | ✅（继续工作） | v0.114.0 |

**⚠️ 重要限制**：`PreToolUse` / `PostToolUse` 目前仅拦截 **简单 shell 调用** 和 `apply_patch`。`unified_exec` 机制下的 richer streaming stdin/stdout 拦截尚不完整，`WebSearch` 等非 shell 工具也不被拦截。

---

## 3. Hook Handler 类型

Codex 目前仅支持 **`command` 类型** 的 hook handler：

| 字段 | 必需 | 默认值 | 说明 |
|------|------|--------|------|
| `type` | ✅ | — | 当前仅 `"command"` |
| `command` | ✅ | — | 执行的 shell 命令 |
| `timeout` | ❌ | `600` | 超时秒数 |
| `statusMessage` | ❌ | — | 运行时的状态消息 |

Commands 以会话 `cwd` 作为工作目录运行。对于仓库级 hooks，建议通过 `git rev-parse --show-toplevel` 解析路径，避免从子目录启动时相对路径失效。

---

## 4. 输入/输出格式

### 公共输入字段

所有事件的 command hook 都通过 **stdin** 接收一个 JSON 对象：

| 字段 | 类型 | 说明 |
|------|------|------|
| `session_id` | `string` | 当前会话或线程 ID |
| `transcript_path` | `string \| null` | 会话转录文件路径 |
| `cwd` | `string` | 会话工作目录 |
| `hook_event_name` | `string` | 当前 hook 事件名 |
| `model` | `string` | 当前使用的模型 slug |

Turn-scoped 事件（`PreToolUse`, `PermissionRequest`, `PostToolUse`, `UserPromptSubmit`, `Stop`）额外包含：

| 字段 | 类型 | 说明 |
|------|------|------|
| `turn_id` | `string` | Codex 特有的当前 turn ID |

### 公共输出字段

`SessionStart`, `UserPromptSubmit`, `Stop` 共享以下 JSON 输出：

```json
{
  "continue": true,
  "stopReason": "optional",
  "systemMessage": "optional",
  "suppressOutput": false
}
```

| 字段 | 效果 |
|------|------|
| `continue` | `false` 标记该 hook 运行为 stopped |
| `stopReason` | 记录停止原因 |
| `systemMessage` | 在 UI 或事件流中显示为警告 |
| `suppressOutput` | 已解析但尚未实现 |

退出码语义：
- **Exit 0 + 无输出**：成功，Codex 继续
- **Exit 0 + 纯文本 stdout**：`SessionStart` 时作为额外开发者上下文；其他事件忽略纯文本
- **Exit 0 + JSON stdout**：解析为结构化输出
- **Exit 2 + stderr**：阻塞行为，stderr 文本作为反馈

---

## 5. 各事件的详细 Schema

### SessionStart

**Matcher**：应用于 `source` 字段。

**额外输入字段**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `source` | `string` | 启动方式：`startup` 或 `resume` |

**输出**：

- **纯文本 stdout**：作为额外开发者上下文注入
- **JSON stdout**：支持公共输出字段 + `hookSpecificOutput.additionalContext`

```json
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "Load the workspace conventions before editing."
  }
}
```

### PreToolUse

**Matcher**：应用于 `tool_name` 和 matcher 别名。`apply_patch` 可用 `Edit` 或 `Write` 匹配。

**额外输入字段**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `turn_id` | `string` | Codex turn ID |
| `tool_name` | `string` | 规范工具名：`Bash`、`apply_patch`、MCP 名如 `mcp__fs__read` |
| `tool_use_id` | `string` | 本次调用的工具调用 ID |
| `tool_input` | `JSON` | 工具参数。`Bash` / `apply_patch` 用 `tool_input.command` |

**输出**：

- 纯文本 stdout **被忽略**
- JSON stdout 支持 `systemMessage` 和以下 hook-specific 形状：

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Destructive command blocked by hook."
  }
}
```

Codex 也接受旧版 block 形状：

```json
{
  "decision": "block",
  "reason": "Destructive command blocked by hook."
}
```

也可用 **exit 2 + stderr** 达到同样效果。

**⚠️ 已解析但尚不支持**：`permissionDecision: "allow"` / `"ask"`、旧版 `decision: "approve"`、`updatedInput`、`additionalContext`、`continue: false`、`stopReason`、`suppressOutput`。这些字段目前 fail open。

### PermissionRequest

**Matcher**：应用于 `tool_name` 和别名。支持 `Bash`、`apply_patch`、MCP 工具名。

**额外输入字段**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `turn_id` | `string` | Codex turn ID |
| `tool_name` | `string` | 规范工具名 |
| `tool_input` | `JSON` | 工具参数 |
| `tool_input.description` | `string \| null` | 人工可读的审批原因 |

**输出**：

- 纯文本 stdout **被忽略**
- 批准：

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PermissionRequest",
    "decision": {
      "behavior": "allow"
    }
  }
}
```

- 拒绝：

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PermissionRequest",
    "decision": {
      "behavior": "deny",
      "message": "Blocked by repository policy."
    }
  }
}
```

**多 hook 决策规则**：任何 `deny` 获胜；否则 `allow` 跳过审批提示；无决策则走正常审批流。

**⚠️ 不要返回**：`updatedInput`、`updatedPermissions`、`interrupt` — 这些字段目前 fail closed。

### PostToolUse

**Matcher**：应用于 `tool_name` 和别名。

**额外输入字段**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `turn_id` | `string` | Codex turn ID |
| `tool_name` | `string` | 规范工具名 |
| `tool_use_id` | `string` | 工具调用 ID |
| `tool_input` | `JSON` | 工具参数 |
| `tool_response` | `JSON` | 工具输出。MCP 工具为 MCP 调用结果 |

**输出**：

- 纯文本 stdout **被忽略**
- JSON 支持 `systemMessage` 和：

```json
{
  "decision": "block",
  "reason": "The Bash output needs review before continuing.",
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": "The command updated generated files."
  }
}
```

**⚠️ 重要**：`decision: "block"` **不会撤销已执行的 Bash 命令**。Codex 记录反馈，用该反馈替换工具结果，然后从 hook 提供的消息继续模型推理。

要停止原始工具结果的正常处理，返回 `continue: false`。Codex 将用反馈文本替换工具结果并继续。

也可用 **exit 2 + stderr**。

**已解析但尚不支持**：`updatedMCPToolOutput`、`suppressOutput`。

### UserPromptSubmit

**Matcher**：当前 **不使用**，任何配置的 matcher 都被忽略。

**额外输入字段**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `turn_id` | `string` | Codex turn ID |
| `prompt` | `string` | 即将发送的用户 prompt |

**输出**：

- 纯文本 stdout：作为额外开发者上下文注入
- JSON 支持公共输出字段 + `hookSpecificOutput.additionalContext`

```json
{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "Ask for a clearer reproduction before editing files."
  }
}
```

阻止 prompt：

```json
{
  "decision": "block",
  "reason": "Ask for confirmation before doing that."
}
```

也可用 **exit 2 + stderr**。

### Stop

**Matcher**：当前 **不使用**。

**额外输入字段**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `turn_id` | `string` | Codex turn ID |
| `stop_hook_active` | `boolean` | 该 turn 是否已被 `Stop` 继续过 |
| `last_assistant_message` | `string \| null` | 最新的 assistant 消息文本 |

**输出**：

- **纯文本 stdout 无效**（此事件要求 JSON 输出）
- 让 Codex 继续工作：

```json
{
  "decision": "block",
  "reason": "Run one more pass over the failing tests."
}
```

**⚠️ 语义反转**：`decision: "block"` 在这里**不拒绝 turn**，而是告诉 Codex **继续**，并用 `reason` 作为新的 continuation prompt 文本。

也可用 **exit 2 + stderr**。

如果任何匹配的 `Stop` hook 返回 `continue: false`，该决策优先于其他 continuation 决策。

---

## 6. Matcher 模式

Codex 的 `matcher` 是 **正则表达式字符串**：

| Matcher 值 | 效果 |
|-----------|------|
| `"*"`, `""`, 或省略 | 匹配所有 |
| 其他 | 作为正则表达式匹配 |

### 各事件的 Matcher 支持

| 事件 | Matcher 过滤目标 | 示例 |
|------|-----------------|------|
| `PreToolUse` | tool name | `Bash`, `^apply_patch$`, `Edit\|Write`, `mcp__filesystem__read_file` |
| `PermissionRequest` | tool name | `Bash`, `apply_patch`, `mcp__.*` |
| `PostToolUse` | tool name | `Bash`, `^apply_patch$`, `mcp__filesystem__.*` |
| `SessionStart` | 启动来源 | `startup`, `resume`, `clear`, `startup\|resume\|clear` |
| `UserPromptSubmit` | **无** | 任何 matcher 被忽略 |
| `Stop` | **无** | 任何 matcher 被忽略 |

**⚠️ 注意**：`apply_patch` 匹配时可用 `Edit` 或 `Write` 作为别名，但 hook 输入中 `tool_name` 仍报告为 `"apply_patch"`。

---

## 7. 并行执行与合并规则

- 多个配置文件中的 **所有匹配 hooks 都会运行**
- 同一事件的多个匹配 command hooks **并发启动**
- 一个 hook **不能阻止** 另一个匹配 hook 启动
- 高层配置 **不替换** 低层配置的 hooks（全部合并）

### 多 hook 决策规则

- **`PermissionRequest`**：任何 `deny` > `allow` > 无决策（走正常审批流）
- **`Stop`**：任何 `continue: false` > `decision: block`（continuation）
- 其他事件无多 hook 决策合并规则文档

---

## 8. 对 gxpm 的启示

### 8.1 gxpm 能力映射

| gxpm 能力 | Codex 实现 | 可行方案 |
|-----------|-----------|---------|
| 会话启动注入上下文 | `SessionStart` 返回 `additionalContext` | ✅ 可用。stdout 纯文本或 JSON `additionalContext` |
| Prompt 命中 GXPM-N 注入 issue 状态 | `UserPromptSubmit` 返回 `additionalContext` | ✅ 可用。纯文本 stdout 或 JSON `additionalContext` |
| 记录 `update_plan` | `PreToolUse` + matcher `"apply_patch"` | ⚠️ 部分可用。仅拦截简单调用，`unified_exec` 不完整 |
| 代码格式化后处理 | `PostToolUse` + matcher `"apply_patch"` / `"Bash"` | ⚠️ 可用但范围有限（`WebSearch` 等不拦截） |
| 危险命令拦截 | `PreToolUse` + matcher `"Bash"` | ✅ 可用 |
| 自动审批 | `PermissionRequest` + `decision.behavior: "allow"` | ✅ 可用 |
| Stop 继续工作 | `Stop` + `decision: block` | ✅ 可用 |
| Git hooks（pre-commit 等） | 独立机制 | ✅ 通用，不区分 host |

### 8.2 推荐适配路径

1. **SessionStart 注入**：Codex 的 `SessionStart` 支持 `additionalContext` JSON 输出，是注入项目约定和当前 issue 状态的有效方式。与 Claude Code 的 stdout 注入等价。

2. **UserPromptSubmit 动态上下文**：与 Claude Code 类似，Codex 的 `UserPromptSubmit` 支持 `additionalContext` 注入，是 prompt 命中 GXPM-N 时注入 issue 状态的理想机制。

3. **PreToolUse 审计与拦截**：`PreToolUse` 可以拦截 Bash 和 `apply_patch`（文件编辑），但对 `unified_exec` 和 `WebSearch` 等工具拦截不完整。gxpm 应将其作为**辅助防线**，不能依赖为唯一安全边界。

4. **Stop 继续工作**：Codex 的 `Stop` hook 语义特殊 — `decision: block` 实际上是让 Codex 继续工作。这对 gxpm 的 QA 验证场景有用：在 `Stop` 时运行测试，失败则让 Codex 继续修复。

5. **PermissionRequest 自动审批**：对于高频的 Bash/apply_patch 审批，可用 `PermissionRequest` 自动批准低风险操作。

### 8.3 配置示例（gxpm 用例）

```json
// .codex/hooks.json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume",
        "hooks": [
          {
            "type": "command",
            "command": "gxpm hook session-start",
            "timeout": 5,
            "statusMessage": "Loading gxpm session context"
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "gxpm hook user-prompt-submit",
            "timeout": 3
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "gxpm hook pre-tool-use",
            "timeout": 5,
            "statusMessage": "Checking gxpm policy"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "gxpm hook stop",
            "timeout": 30,
            "statusMessage": "Running gxpm stop checks"
          }
        ]
      }
    ]
  }
}
```

### 8.4 与 Claude Code 的关键差异

| 维度 | Codex | Claude Code |
|------|-------|------------|
| **SessionStart 上下文注入** | ✅ JSON `additionalContext` | ✅ stdout 纯文本 |
| **UserPromptSubmit 上下文注入** | ✅ JSON `additionalContext` | ✅ JSON `additionalContext` |
| **事件总数** | 6 种 | 28 种 |
| **Handler 类型** | 仅 `command` | 5 种 |
| **Async 支持** | ❌ | ✅ |
| **HTTP hooks** | ❌ | ✅ |
| **MCP tool hooks** | ❌ | ✅ |
| **Prompt/Agent hooks** | ❌ | ✅ |
| **Matcher 语法** | 正则表达式 | 精确字符串 / `\|` 列表 / JS 正则 |
| **`if` 字段** | ❌ | ✅（Permission rule 语法） |
| **去重** | ❌ | ✅ |
| **Plugin/Skill hooks** | ❌（Plugin 支持 hooks/hooks.json） | ✅ |
| **Stop `decision: block` 语义** | ✅ 继续工作 | ✅ 阻止停止 |
| **`PostToolUse` block** | ⚠️ 不撤销，替换结果 | ❌ 不支持 block |
| **工具拦截完整度** | ⚠️ 仅简单 shell / apply_patch | ✅ 完整 |
| **CLI 验证** | ❌ | ✅ `/hooks` 菜单 |

---

## 9. 已知限制与注意事项

1. **Feature flag 必需**：Hooks 默认关闭，必须设置 `codex_hooks = true`
2. **工具拦截不完整**：`unified_exec`、streaming shell、`WebSearch` 等不被 `PreToolUse` / `PostToolUse` 拦截
3. **`PreToolUse` 不支持 allow/ask**：`permissionDecision: "allow"` / `"ask"` 已解析但 fail open
4. **`Stop` 纯文本无效**：此事件要求 JSON 输出，纯文本 stdout 会导致错误
5. **`UserPromptSubmit` / `Stop` 无 matcher**：任何配置的 matcher 都被忽略
6. **Legacy notify 系统**：Codex 还有一个旧的 `notify = ["bash", "-lc", "script"]` 配置，在 `agent-turn-complete` 时触发。Hooks 系统稳定后将取代 notify。
7. **Config.toml hooks 回归**：OpenAI/codex#19199 和 #19300 记录了 config.toml 内联 hooks 的解析回归问题。建议优先使用独立的 `hooks.json`。

---

## 10. 待验证事项

- [ ] `PreToolUse` 的 `updatedInput` 重写何时正式支持
- [ ] `unified_exec` 启用后 `PreToolUse` 拦截行为的变化
- [ ] `PostToolUse` 的 `updatedMCPToolOutput` 支持时间线
- [ ] Codex Plugin 的 `hooks/hooks.json` 与 gxpm 的集成方式
- [ ] Codex CLI 是否有计划增加 `async` hook 支持
- [ ] `Stop` hook 的 `last_assistant_message` 字段在 continuation 场景中的实际行为

---

## 参考文档

- https://developers.openai.com/codex/hooks — Codex Hooks 官方文档（完整 schema、JSON I/O）
- https://developers.openai.com/codex/config-reference — Codex 配置参考（feature flags）
- https://github.com/openai/codex — Codex CLI 源码仓库（wire schema）
- https://github.com/openai/codex/issues/19199 — config.toml hooks 回归问题
