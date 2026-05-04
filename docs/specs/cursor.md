# Cursor Host 规范镜像

## 平台标识

- **名称**: Cursor IDE
- **上下文长度**: ~200K tokens（Claude 3.5 Sonnet / GPT-4o）
- **工具支持**: MCP、Composer、Tab

## 上下文格式

- 优先使用 `.cursorrules` 或项目根目录的规则文件
- 支持 `AGENTS.md` 和 `CLAUDE.md` 作为补充契约
- Composer 模式支持多文件编辑和全局上下文

## 工具调用约定

- **MCP**: 通过 Cursor Settings 中的 MCP 配置添加
- **Composer**: 支持 `@` 引用文件、符号、文档
- **Tab**: 自动补全基于当前文件和打开的标签页上下文

## 已知限制

- 无原生 hooks 系统，需通过 gxpm 的 IDE 插件或外部脚本模拟
- `.cursorrules` 长度受限，复杂规则需拆分到 `docs/governance/`
- 不区分 Skills 和 Plugins 概念

## gxpm 集成点

- `hosts/cursor.ts` — Cursor 宿主适配器
- `docs/governance/cursor-rules.md` — Cursor 专属规则（如存在）
- 通过 gxpm CLI 在终端中查询 issue 状态，再复制关键信息到 Composer

## 工作流差异

| 阶段 | Cursor 行为 |
|------|-------------|
| 启动 | 加载 .cursorrules + 打开的文件上下文 |
| 用户提示 | Composer 支持多文件 @ 引用 |
| 文件编辑 | 内联 diff 或 Composer 批量编辑 |
| 终端集成 | 内置终端可直接运行 gxpm CLI |

## 同步策略

当 `hosts/cursor.ts` 或 Cursor 专属规则文件发生变更时，同步更新本文档。
