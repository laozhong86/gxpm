# Codex Host 规范镜像

## 平台标识

- **名称**: OpenAI Codex CLI
- **上下文长度**: ~128K tokens（GPT-4o）
- **工具支持**: MCP、Hooks、Plugins

## 上下文格式

- 优先使用 `AGENTS.md` 作为项目级契约文件
- 支持 `.codex/` 目录下的 `hooks.json` 和 `config.toml`
- 支持 `CLAUDE.md` 作为共享契约（与 Claude 兼容）

## 工具调用约定

- **MCP**: 通过 `.codex/config.toml` 或 `.mcp.json` 配置
- **Hooks**: `hooks.json` 定义事件钩子（SessionStart、UserPromptSubmit 等）
- **Plugins**: `plugin.json` 定义插件元数据

## 已知限制

- `apply_patch` 和写文件命令以 cwd 为路径根，worktree 切换后必须 `cd` 到新目录
- `update_plan` 仅用于阶段内细分任务，**不要与 gxpm phase 平行**
- 不原生支持 Claude 的 Skills 系统

## gxpm 集成点

- `hosts/codex.ts` — Codex 宿主适配器
- `.codex/hooks/` — gxpm 注入的 hook 脚本
- `githooks/gxpm-*` — 与 Codex 协同的 git hooks

## 工作流差异

| 阶段 | Codex 行为 |
|------|------------|
| 启动 | 加载 AGENTS.md + hooks + MCP |
| 用户提示 | UserPromptSubmit hook 注入 issue 上下文 |
| 文件编辑 | `apply_patch` / 写文件，需确认 cwd |
| 计划更新 | `update_plan` 仅限子任务，不替代 gxpm phase |

## 同步策略

当 `hosts/codex.ts` 或 `.codex/hooks/` 发生变更时，同步更新本文档。
