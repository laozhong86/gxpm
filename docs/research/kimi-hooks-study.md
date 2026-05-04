# Kimi Code CLI Hooks 机制研究

> 研究日期：2026-05-04  
> 源码来源：`/Users/x/.local/share/uv/tools/kimi-cli/lib/python3.13/site-packages/kimi_cli/hooks/`  
> 版本：v1.40.0（2026-04-28）  
> 状态：Beta（CHANGELOG 标注）

---

## 1. 配置格式

Kimi 的 hooks 配置在 **`~/.kimi/config.toml`** 的 `[[hooks]]` section 中：

```toml
[[hooks]]
event = "SessionStart"
command = "/path/to/session-start.sh"
matcher = ""
timeout = 30

[[hooks]]
event = "UserPromptSubmit"
command = "/path/to/prompt-submit.sh"
matcher = "GXPM-[0-9]+"
timeout = 30

[[hooks]]
event = "PreToolUse"
command = "/path/to/pre-tool-use.sh"
matcher = "edit_file|write_file"
timeout = 10
```

### HookDef 字段

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `event` | `HookEventType` | — | 触发事件（13 种之一） |
| `command` | `string` | — | 执行的 shell 命令，接收 JSON stdin |
| `matcher` | `string` | `""` | 正则过滤模式，空字符串匹配所有 |
| `timeout` | `int` | `30` | 超时秒数，范围 1-600 |

---

## 2. 事件类型（13 种）

Kimi 支持 **13 个生命周期事件**，远超 Codex 的 3 个：

| 事件 | 触发时机 | matcher_value | 典型用途 |
|------|---------|---------------|---------|
| `SessionStart` | 会话启动（startup / resume） | `"startup"` / `"resume"` | 初始化、环境检测 |
| `SessionEnd` | 会话结束 | `""` | 清理、归档 |
| `UserPromptSubmit` | 用户提交 prompt | prompt 文本 | 关键词拦截、注入上下文（有限） |
| `Stop` | 正常停止 | `""` | 保存状态 |
| `StopFailure` | 停止失败 | error_type | 错误上报 |
| `PreToolUse` | 工具调用前 | tool_name | 权限控制、审计 |
| `PostToolUse` | 工具调用成功 | tool_name | 日志、后处理 |
| `PostToolUseFailure` | 工具调用失败 | tool_name | 错误处理 |
| `SubagentStart` | 子 Agent 启动 | agent_name | 监控、配额 |
| `SubagentStop` | 子 Agent 结束 | agent_name | 结果收集 |
| `PreCompact` | 上下文压缩前 | trigger | 保存关键信息 |
| `PostCompact` | 上下文压缩后 | trigger | 验证压缩结果 |
| `Notification` | 通知事件 | sink | 消息路由 |

---

## 3. 输入 JSON 格式

所有事件都包含基础字段：

```json
{
  "hook_event_name": "SessionStart",
  "session_id": "...",
  "cwd": "/path/to/repo"
}
```

各事件的额外字段：

### SessionStart
```json
{
  "source": "startup"   // 或 "resume"
}
```

### UserPromptSubmit
```json
{
  "prompt": "用户输入的文本"
}
```

### PreToolUse / PostToolUse / PostToolUseFailure
```json
{
  "tool_name": "edit_file",
  "tool_input": { ... },
  "tool_call_id": "..."
}
```

### SubagentStart / SubagentStop
```json
{
  "agent_name": "coder",
  "prompt": "...",        // SubagentStart
  "response": "..."       // SubagentStop
}
```

---

## 4. 执行语义

### 4.1 并行执行

同一事件的多个匹配 hooks **并行执行**（`asyncio.gather`）。

### 4.2 Fail-Open

- 命令执行失败 → `allow`
- 超时 → `allow`（`timed_out: true`）
- 异常 → `allow`

**安全设计**：telemetry 失败不会丢弃 hook 结果，避免 security-critical hooks（如 PreToolUse block）被静默绕过。

### 4.3 Block 机制

Kimi hooks 支持 **block/allow 决策**，这是 Codex hooks 不具备的能力：

| 方式 | 行为 |
|------|------|
| Exit code 2 | Block，reason 取 stderr |
| Exit 0 + JSON stdout | 解析 `hookSpecificOutput.permissionDecision: "deny"` |
| 其他 exit code | Allow |

Block 示例（shell）：
```bash
#!/bin/bash
INPUT=$(cat)
# ... 检查逻辑 ...
echo "敏感操作被拦截" >&2
exit 2
```

Block 示例（JSON）：
```json
{
  "hookSpecificOutput": {
    "permissionDecision": "deny",
    "permissionDecisionReason": "不允许修改 .env 文件"
  }
}
```

### 4.4 去重

同一 command 在同一事件中只执行一次（`seen_commands: set[str]`）。

---

## 5. 与 Codex Hooks 的关键差异

| 维度 | Kimi | Codex |
|------|------|-------|
| **配置文件** | `~/.kimi/config.toml` (`[[hooks]]`) | `.codex/hooks.json` |
| **事件数量** | 13 种 | 3 种（SessionStart, UserPromptSubmit, PreToolUse） |
| **Matcher 过滤** | ✅ 正则匹配 | ❌ 不支持 |
| **Block 机制** | ✅ exit 2 或 JSON deny | ❌ 不支持 |
| **上下文注入** | ❌ 不支持 | ✅ SessionStart 返回 `additionalContext` |
| **超时控制** | ✅ 可配 1-600s | ❌ 固定 600s |
| **执行模式** | 并行 + fail-open | 顺序？（未确认） |
| **Wire 支持** | ✅ HookRequest/HookResponse | ❌ 不支持 |
| **技能目录** | `.kimi/skills/` + 合并其他品牌 | `.codex/skills/` |

### ⚠️ 关键发现：SessionStart 不能注入上下文

Codex 的 `SessionStart` hook 可以返回 JSON：
```json
{"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": "..."}}
```

Kimi 的 `SessionStart` hook **返回值被忽略**（`cli/__init__.py:641-651`）。它只能用于：
- 副作用（如写日志、触发后台任务）
- Block（`permissionDecision: deny`）

**这意味着 gxpm 的 Codex SessionStart 能力（注入 gxpm 版本信息、wiki 状态）在 Kimi 上无法直接复用。**

---

## 6. Wire 协议中的 Hooks

Kimi CLI 支持 **Wire 协议**（用于 VS Code 扩展、Web UI 等客户端），hooks 在 Wire 中有完整的事件流：

### 服务端 → 客户端
- `HookTriggered`：hooks 开始执行
- `HookResolved`：hooks 执行完成（含 action, reason, duration_ms）
- `HookRequest`：请求客户端处理 hook（客户端订阅模式）

### 客户端 → 服务端
- `HookResponse`：客户端决策（allow/block）

### 客户端订阅

Wire 客户端可通过 `initialize` 订阅 hook 事件：
```json
{
  "hooks": [
    {"id": "1", "event": "PreToolUse", "matcher": "edit_file", "timeout": 30}
  ]
}
```

---

## 7. CLI 命令

```bash
/hooks          # 列出所有配置的 hooks
```

---

## 8. 对 gxpm 的启示

### 8.1 Kimi 适配策略（与 Codex 不同）

| gxpm 能力 | Codex 实现 | Kimi 可行方案 |
|-----------|-----------|--------------|
| 会话启动注入上下文 | `SessionStart` 返回 `additionalContext` | ❌ 不可用。需改用 **Skill 系统**（`~/.kimi/skills/gxpm/SKILL.md`）在系统 prompt 中注入 |
| Prompt 命中 GXPM-N 注入 issue 状态 | `UserPromptSubmit` 返回上下文文本 | ❌ 不可用。需改用 `UserPromptSubmit` **block** 机制拦截 prompt，然后让模型重新发起带上下文的 prompt（复杂且不优雅）。更实际的方案是继续依赖 Skill 中的规则 |
| 记录 `update_plan` | `PreToolUse` 拦截 `update_plan` | ✅ 可用，且支持 matcher `"update_plan"` |
| Git hooks（pre-commit 等） | 独立机制 | ✅ 通用，不区分 host |

### 8.2 推荐适配路径

1. **Skill 优先**：Kimi 的 Skill 系统（`~/.kimi/skills/gxpm/SKILL.md`）是注入上下文的主要方式，与 Codex 的 `additionalContext` 不同但效果等价
2. **Hooks 辅助**：仅用于 `PreToolUse`（记录 update_plan）和可能的 `PostToolUse`（审计）
3. **不依赖 SessionStart**：在 Kimi 上无注入能力

### 8.3 配置示例（假设）

```toml
# ~/.kimi/config.toml
[[hooks]]
event = "PreToolUse"
command = "/Users/x/.kimi/hooks/gxpm-pre-tool-use.sh"
matcher = "update_plan"
timeout = 10
```

---

## 9. 待验证事项

- [ ] Kimi Skill 的 frontmatter 是否支持 `name` + `description`（Codex 需要 `name`/`description` allowlist）
- [ ] `merge_all_available_skills = true` 默认开启后，`.kimi/skills/` 和 `.claude/skills/` 是否会冲突
- [ ] 项目级 `.kimi/skills/` 的自动发现路径（已确认：向上走到最近 `.git` 祖先）
- [ ] Kimi 是否支持类似 Codex 的 `statusMessage` 字段

---

## 参考源码

- `kimi_cli/hooks/config.py` — HookDef / HookEventType 定义
- `kimi_cli/hooks/engine.py` — HookEngine 执行引擎
- `kimi_cli/hooks/events.py` — 各事件的输入 payload 构建器
- `kimi_cli/hooks/runner.py` — run_hook / HookResult（block/allow 决策）
- `kimi_cli/cli/__init__.py:641` — SessionStart hook 调用点
- `kimi_cli/soul/kimisoul.py:594` — UserPromptSubmit hook 调用点
- `kimi_cli/soul/toolset.py:163` — PreToolUse hook 调用点
- `kimi_cli/wire/types.py` — Wire 协议中的 HookTriggered / HookResolved / HookRequest / HookResponse
