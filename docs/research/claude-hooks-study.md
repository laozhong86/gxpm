# Claude Code CLI Hooks 机制研究

> 研究日期：2026-05-04
> 文档来源：https://code.claude.com/docs/en/hooks.md（Hooks Reference）
> 版本：Claude Code CLI v2.1.126（2026-04-24）
> 状态：Stable（生产可用，/hooks 菜单可验证）

---

## 1. 配置格式与位置

Claude Code 的 hooks 定义在 **JSON settings 文件**中，通过嵌套三层结构组织：

1. **Hook Event** — 生命周期触发点（如 `PreToolUse`、`SessionStart`）
2. **Matcher Group** — 过滤条件（如 `"Bash"`、`"Edit|Write"`）
3. **Hook Handler** — 实际执行的命令/HTTP/Agent

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "if": "Bash(rm *)",
            "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/block-rm.sh",
            "timeout": 10
          }
        ]
      }
    ],
    "SessionStart": [
      {
        "matcher": "startup|resume",
        "hooks": [
          {
            "type": "command",
            "command": "echo 'Reminder: use Bun, not npm.'"
          }
        ]
      }
    ]
  }
}
```

### 配置位置与作用域

| 位置 | 作用域 | 可提交到仓库 |
|------|--------|-------------|
| `~/.claude/settings.json` | 全局所有项目 | ❌ |
| `.claude/settings.json` | 单个项目 | ✅ |
| `.claude/settings.local.json` | 单个项目 | ❌（gitignored） |
| Managed policy settings | 组织级 | ✅（管理员控制） |
| Plugin `hooks/hooks.json` | Plugin 启用时 | ✅ |
| Skill/Agent frontmatter | 组件激活期间 | ✅ |

Enterprise 管理员可用 `allowManagedHooksOnly: true` 禁用用户级 hooks，仅允许 managed policy hooks。

### 禁用 hooks

```json
{ "disableAllHooks": true }
```

Managed hooks 只能通过 managed settings 级别的 `disableAllHooks` 禁用。

---

## 2. 事件类型（28 种）

Claude Code 支持 **28 个生命周期事件**，是三大 CLI 中最丰富的：

| 事件 | 触发时机 | 匹配字段 | 可 Block |
|------|---------|---------|---------|
| `SessionStart` | 会话开始或恢复 | `source`: startup/resume/clear/compact | ❌ |
| `Setup` | `--init-only` 或 `--init` / `--maintenance` 在 `-p` 模式 | `init` / `maintenance` | ❌ |
| `UserPromptSubmit` | 用户提交 prompt 前 | 无 matcher | ✅ |
| `UserPromptExpansion` | 用户输入的命令展开为 prompt 前 | command name | ✅ |
| `PreToolUse` | 工具调用执行前 | tool name | ✅ |
| `PermissionRequest` | 权限对话框出现时 | tool name | ✅ |
| `PermissionDenied` | auto mode 拒绝工具调用时 | tool name | ✅ |
| `PostToolUse` | 工具调用成功后 | tool name | ❌ |
| `PostToolUseFailure` | 工具调用失败后 | tool name | ❌ |
| `PostToolBatch` | 一批并行工具调用完成后 | 无 matcher | ❌ |
| `Notification` | Claude Code 发送通知时 | notification type | ❌ |
| `SubagentStart` | Subagent 被创建时 | agent type | ❌ |
| `SubagentStop` | Subagent 完成时 | agent type | ✅ |
| `TaskCreated` | Task 被创建时 | 无 matcher | ✅ |
| `TaskCompleted` | Task 被标记完成时 | 无 matcher | ✅ |
| `Stop` | Claude 完成响应时 | 无 matcher | ✅ |
| `StopFailure` | 因 API 错误结束 turn 时 | error type | ❌（忽略输出） |
| `TeammateIdle` | Agent team 队友即将 idle 时 | 无 matcher | ✅ |
| `InstructionsLoaded` | CLAUDE.md 或 rules 加载时 | load reason | ❌ |
| `ConfigChange` | 配置文件变更时 | config source | ✅ |
| `CwdChanged` | 工作目录变更时 | 无 matcher | ❌ |
| `FileChanged` | 被监视文件变更时 | 文件名列表 | ❌ |
| `WorktreeCreate` | worktree 被创建时 | 无 matcher | ✅（任何非零退出码） |
| `WorktreeRemove` | worktree 被移除时 | 无 matcher | ❌ |
| `PreCompact` | 上下文压缩前 | manual/auto | ❌ |
| `PostCompact` | 上下文压缩完成后 | manual/auto | ❌ |
| `Elicitation` | MCP server 请求用户输入时 | MCP server name | ❌ |
| `ElicitationResult` | 用户响应 MCP elicitation 后 | MCP server name | ❌ |
| `SessionEnd` | 会话终止时 | end reason | ❌ |

---

## 3. Hook Handler 类型（5 种）

| 类型 | 字段 | 说明 |
|------|------|------|
| `command` | `command`, `async`, `asyncRewake`, `shell` | 执行 shell 命令，JSON 通过 stdin 传入 |
| `http` | `url`, `headers`, `allowedEnvVars` | POST JSON 到 HTTP 端点 |
| `mcp_tool` | `server`, `tool`, `input` | 调用已连接的 MCP server 工具 |
| `prompt` | `prompt`, `model` | 发送给 Claude 模型做单轮评估（yes/no JSON） |
| `agent` | `prompt`, `model`, `timeout` | 生成 subagent 用工具验证条件（实验性） |

### 公共字段（所有类型共享）

| 字段 | 必需 | 说明 |
|------|------|------|
| `type` | ✅ | `"command"` / `"http"` / `"mcp_tool"` / `"prompt"` / `"agent"` |
| `if` | ❌ | Permission rule 语法过滤（仅工具事件有效） |
| `timeout` | ❌ | 秒，默认 600（command）、30（prompt）、60（agent） |
| `statusMessage` | ❌ | Hook 运行时的 spinner 消息 |
| `once` | ❌ | 仅 skill frontmatter 中有效，每会话只运行一次 |

### Command Hook 特有字段

| 字段 | 说明 |
|------|------|
| `async` | `true` 时后台运行，不阻塞 |
| `asyncRewake` | `true` 时后台运行且退出码 2 时唤醒 Claude，stderr/stdout 作为系统提醒 |
| `shell` | `"bash"`（默认）或 `"powershell"` |

---

## 4. 输入/输出格式

### 公共输入字段

所有事件都包含以下字段（通过 stdin 传入 command hooks，通过 POST body 传入 HTTP hooks）：

| 字段 | 说明 |
|------|------|
| `session_id` | 当前会话标识符 |
| `transcript_path` | 对话 JSON 路径 |
| `cwd` | Hook 调用时的工作目录 |
| `permission_mode` | 当前权限模式 |
| `hook_event_name` | 触发的事件名 |

Subagent / `--agent` 模式下额外包含：

| 字段 | 说明 |
|------|------|
| `agent_id` | Subagent 唯一标识 |
| `agent_type` | Agent 名称（如 `"Explore"`） |

### 退出码语义

| 退出码 | 含义 |
|--------|------|
| `0` | 成功。stdout 解析为 JSON 输出；`UserPromptSubmit`/`UserPromptExpansion`/`SessionStart` 的 stdout 文本作为上下文注入 |
| `2` | **阻塞错误**。stderr 文本反馈给 Claude；行为取决于事件（见下表） |
| 其他 | **非阻塞错误**。转录中显示 `<hook> hook error: <stderr 第一行>`，执行继续 |

**⚠️ 重要**：只有退出码 2 能阻塞行为。退出码 1 被视为非阻塞错误，执行继续。如果目的是策略执行，必须使用 `exit 2`。

### 退出码 2 的行为（按事件）

| 事件 | 可 Block | 退出码 2 效果 |
|------|---------|--------------|
| `PreToolUse` | ✅ | 阻止工具调用 |
| `PermissionRequest` | ✅ | 拒绝权限 |
| `UserPromptSubmit` | ✅ | 阻止 prompt 处理并擦除 prompt |
| `UserPromptExpansion` | ✅ | 阻止命令展开 |
| `Stop` | ✅ | 阻止 Claude 停止，继续对话 |
| `SubagentStop` | ✅ | 阻止 subagent 停止 |
| `TeammateIdle` | ✅ | 阻止队友进入 idle |
| `TaskCreated` | ✅ | 回滚任务创建 |
| `TaskCompleted` | ✅ | 阻止任务标记完成 |
| `ConfigChange` | ✅ | 阻止配置变更生效 |
| `WorktreeCreate` | ✅ | **任何非零退出码** 都中止 worktree 创建 |
| `SessionStart` / `Setup` / `Notification` / `PostToolUse` / `PostToolBatch` / `StopFailure` / `PreCompact` / `PostCompact` / `Elicitation` / `ElicitationResult` / `InstructionsLoaded` / `CwdChanged` / `FileChanged` / `WorktreeRemove` / `SessionEnd` | ❌ | 退出码 2 显示 stderr 给用户，执行继续 |

### JSON 输出格式

**`PreToolUse` / `PermissionDenied`：**

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Destructive command blocked by hook"
  }
}
```

`permissionDecision` 值：`"allow"`（跳过交互确认）、`"deny"`（取消）、`"ask"`（正常提示）、`"defer"`（非交互模式 -p 下保留工具调用）

**`PermissionRequest`：**

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PermissionRequest",
    "decision": {
      "behavior": "allow",
      "updatedPermissions": [
        { "type": "setMode", "mode": "acceptEdits", "destination": "session" }
      ]
    }
  }
}
```

**`Stop` / `PostToolUse` / `PostToolBatch`：**

```json
{
  "decision": "block",
  "reason": "Run tests before stopping"
}
```

**`UserPromptSubmit`：**

```json
{
  "additionalContext": "Context to inject into Claude's view"
}
```

**`SessionStart`：** 退出码 0 时的 stdout 文本直接作为上下文注入（不支持 JSON `additionalContext`）。

---

## 5. Matcher 模式

| Matcher 值 | 评估方式 | 示例 |
|-----------|---------|------|
| `"*"`, `""`, 或省略 | 匹配所有 | 每次事件都触发 |
| 仅字母、数字、`_`、`|` | 精确字符串或 `\|` 分隔列表 | `Bash` 精确匹配 Bash；`Edit\|Write` 匹配两者 |
| 包含其他字符 | JavaScript 正则表达式 | `^Notebook` 匹配 Notebook 开头；`mcp__memory__.*` 匹配 memory server 所有工具 |

### 各事件的 Matcher 字段

| 事件 | Matcher 过滤目标 | 示例 |
|------|-----------------|------|
| `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionRequest`, `PermissionDenied` | tool name | `Bash`, `Edit\|Write`, `mcp__.*` |
| `SessionStart` | 会话启动方式 | `startup`, `resume`, `clear`, `compact` |
| `Setup` | CLI flag | `init`, `maintenance` |
| `SessionEnd` | 结束原因 | `clear`, `resume`, `logout`, `prompt_input_exit` 等 |
| `Notification` | 通知类型 | `permission_prompt`, `idle_prompt`, `auth_success` 等 |
| `SubagentStart`, `SubagentStop` | agent 类型 | `general-purpose`, `Explore`, `Plan` 或自定义名 |
| `PreCompact`, `PostCompact` | 触发方式 | `manual`, `auto` |
| `ConfigChange` | 配置来源 | `user_settings`, `project_settings`, `local_settings` 等 |
| `StopFailure` | 错误类型 | `rate_limit`, `authentication_failed`, `billing_error` 等 |
| `InstructionsLoaded` | 加载原因 | `session_start`, `nested_traversal`, `path_glob_match` 等 |
| `Elicitation`, `ElicitationResult` | MCP server 名 | 已配置的 MCP server 名称 |
| `UserPromptExpansion` | 命令名 | Skill 或 command 名称 |
| `FileChanged` | 文件名列表（字面量） | `.envrc\|.env` |
| `UserPromptSubmit`, `PostToolBatch`, `Stop`, `TeammateIdle`, `TaskCreated`, `TaskCompleted`, `WorktreeCreate`, `WorktreeRemove`, `CwdChanged` | **无 matcher 支持** | 每次事件都触发，添加 matcher 被静默忽略 |

### `if` 字段（工具事件专用）

`if` 使用 [permission rule syntax](https://code.claude.com/docs/en/permissions) 同时匹配工具名和参数，比 matcher 更精确：

```json
{
  "matcher": "Bash",
  "hooks": [{
    "type": "command",
    "if": "Bash(git *)",
    "command": "./check-git-policy.sh"
  }]
}
```

`if` 仅对工具事件有效：`PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionRequest`, `PermissionDenied`。其他事件上设置 `if` 会导致 hook 永不运行。

---

## 6. 环境变量

| 变量 | 说明 |
|------|------|
| `$CLAUDE_PROJECT_DIR` | 项目根目录（建议用 `"$CLAUDE_PROJECT_DIR"/.claude/hooks/...` 引用） |
| `${CLAUDE_PLUGIN_ROOT}` | Plugin 安装目录 |
| `${CLAUDE_PLUGIN_DATA}` | Plugin 持久数据目录 |
| `$CLAUDE_ENV_FILE` | 环境变量文件路径（`SessionStart`/`CwdChanged` 可写入） |
| `$CLAUDE_CODE_REMOTE` | 远程 web 环境为 `"true"`，本地 CLI 未设置 |

---

## 7. 并行执行与去重

所有匹配的 hooks **并行运行**。相同的 handler 自动去重：
- Command hooks 按命令字符串去重
- HTTP hooks 按 URL 去重

当多个 hooks 返回决策时，Claude Code 选择**最严格的答案**：
- `deny` > `ask` > `allow`
- `block` 覆盖 `allow`
- `additionalContext` 文本从所有 hooks 保留并合并传递给 Claude

---

## 8. 对 gxpm 的启示

### 8.1 gxpm 能力映射

| gxpm 能力 | Claude Code 实现 | 可行方案 |
|-----------|-----------------|---------|
| 会话启动注入上下文 | `SessionStart` stdout 文本注入 | ✅ **最佳**。stdout 直接作为上下文 |
| Prompt 命中 GXPM-N 注入 issue 状态 | `UserPromptSubmit` 返回 `additionalContext` | ✅ 可用 |
| 记录 `update_plan` | `PreToolUse` + matcher `"ExitPlanMode"` | ✅ 可用 |
| Git hooks（pre-commit 等） | 独立机制 | ✅ 通用，不区分 host |
| 自动 approve ExitPlanMode | `PermissionRequest` + matcher `"ExitPlanMode"` + `decision.behavior: "allow"` | ✅ 可用 |
| 代码格式化后处理 | `PostToolUse` + matcher `"Edit\|Write"` | ✅ 可用 |
| 保护敏感文件 | `PreToolUse` + `if: "Edit(*.env)"` | ✅ 可用 |

### 8.2 推荐适配路径

1. **SessionStart 注入**：Claude Code 的 `SessionStart` stdout 注入是三大 CLI 中最直接的上下文注入方式。gxpm 可在 `SessionStart` 中输出项目约定和当前 issue 状态。

2. **UserPromptSubmit 动态上下文**：与 Kimi 不同，Claude Code 的 `UserPromptSubmit` 支持返回 `additionalContext`，是 prompt 命中 GXPM-N 时注入 issue 状态的理想机制。

3. **PreToolUse 审计与拦截**：`PreToolUse` + `if` 字段可以精确拦截特定工具调用（如 `update_plan`），用于记录和审计。

4. **PostToolUse 后处理**：代码格式化、测试运行等后处理任务适合用 `PostToolUse` + `"Edit|Write"` matcher。

5. **PermissionRequest 自动审批**：对于 plan mode 中的 `ExitPlanMode` 等高频确认，可用 `PermissionRequest` 自动审批提升效率。

### 8.3 配置示例（gxpm 用例）

```json
// .claude/settings.json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume",
        "hooks": [
          {
            "type": "command",
            "command": "gxpm hook session-start",
            "timeout": 5
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
        "matcher": "ExitPlanMode",
        "hooks": [
          {
            "type": "command",
            "command": "gxpm hook pre-tool-use",
            "timeout": 3
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "gxpm hook post-tool-use",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

---

## 9. 与 Kimi / Codex 的差异矩阵

| 维度 | Claude Code | Kimi | Codex |
|------|------------|------|-------|
| **事件数量** | 28 种 | 13 种 | 6 种 |
| **配置格式** | JSON (settings.json) | TOML (config.toml `[[hooks]]`) | JSON (hooks.json) + TOML inline |
| **Handler 类型** | 5 种（command/http/mcp_tool/prompt/agent） | 1 种（command） | 1 种（command） |
| **SessionStart 上下文注入** | ✅ stdout 文本直接注入 | ❌ 不支持（返回值被忽略） | ✅ `additionalContext` JSON |
| **UserPromptSubmit 上下文注入** | ✅ `additionalContext` JSON | ❌ 不支持（仅 block） | ✅ `additionalContext` JSON |
| **Block 机制** | exit 2 / JSON `permissionDecision: deny` | exit 2 / JSON `permissionDecision: deny` | exit 2 / JSON `permissionDecision: deny` / `decision: block` |
| **Matcher 语法** | 精确字符串 / `\|` 列表 / JS 正则 | 正则表达式 | 正则表达式 |
| **`if` 字段** | ✅ Permission rule 语法（仅工具事件） | ❌ | ❌ |
| **Async 后台运行** | ✅ `async` / `asyncRewake` | ❌ | ❌ |
| **HTTP hooks** | ✅ | ❌ | ❌ |
| **MCP tool hooks** | ✅ | ❌ | ❌ |
| **Prompt/Agent hooks** | ✅ | ❌ | ❌ |
| **Plugin hooks** | ✅ | ❌ | ❌ |
| **Skill frontmatter hooks** | ✅ | ❌ | ❌ |
| **并行执行** | ✅（所有匹配 hooks 并行） | ✅（server-side 并行，wire-side 订阅） | ✅ |
| **去重** | ✅（按命令字符串 / URL） | ❌ | ❌ |
| **权限模式集成** | ✅（hooks 在权限检查前运行，`deny` 可覆盖 bypassPermissions） | ❌ | ❌ |
| **CLI 验证** | ✅ `/hooks` 菜单 | ✅ `/hooks` 命令 | ❌ |
| **非交互模式** | ✅ `-p` 下 `PermissionRequest` 不触发，用 `PreToolUse` | N/A | ✅ `-p` 下 `PermissionRequest` 不触发 |

---

## 10. 待验证事项

- [ ] `SessionStart` stdout 注入是否有长度限制
- [ ] `additionalContext` 在 `UserPromptSubmit` 中的字符上限
- [ ] `PreToolUse` 的 `updatedInput` 重写能力（多个 hook 同时修改时的竞争）
- [ ] Agent hooks（`type: "agent"`）在 gxpm 场景中的实际可用性
- [ ] Managed policy hooks 在 enterprise 部署中的 gxpm 适配

---

## 参考文档

- https://code.claude.com/docs/en/hooks.md — Hooks Reference（完整事件 schema、JSON I/O、退出码）
- https://code.claude.com/docs/en/hooks-guide.md — Automate workflows with hooks（使用指南与示例）
- https://code.claude.com/docs/en/settings.md — Settings 配置层级
- https://code.claude.com/docs/en/permissions.md — Permission rules 语法（`if` 字段）
- https://code.claude.com/docs/en/plugins-reference.md — Plugin hooks 规范
- https://code.claude.com/docs/en/skills.md — Skill frontmatter hooks
