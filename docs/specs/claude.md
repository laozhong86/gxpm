# Claude Host 规范镜像

## 平台标识

- **名称**: Claude Code / Claude Desktop
- **上下文长度**: ~200K tokens（Claude 3.5 Sonnet）
- **工具支持**: MCP、Skills、Projects

## 上下文格式

- 优先使用 `CLAUDE.md` 作为项目级契约文件
- 支持 `.claude/skills/` 目录下的 SKILL.md 技能系统
- 支持 frontmatter 元数据解析

## 工具调用约定

- **MCP**: 通过 `.mcp.json` 或 `CLAUDE.md` 中的 `mcpServers` 字段配置
- **Skills**: 自动发现 `.claude/skills/*/SKILL.md`，按 scope（Project > User > Extra > Built-in）优先级解析
- **Projects**: 支持项目级知识库，与 gxpm 的 `.gxpm/` 本地状态互补

## 已知限制

- 无法直接读取 `.gxpm/issues/` 的 JSON 状态文件，需要通过 gxpm CLI 查询
- 不原生支持 Codex 的 `hooks.json` 机制
- Skills 冲突时按 scope 优先级覆盖，不合并

## gxpm 集成点

- `hosts/claude.ts` — Claude 宿主适配器
- `skills/gxpm/` — gxpm 核心 skill
- SessionStart hook 注入 gxpm 能力提醒
- UserPromptSubmit hook 在命中 GXPM-N 时注入 issue 上下文

## 工作流差异

| 阶段 | Claude 行为 |
|------|-------------|
| 启动 | 加载 CLAUDE.md + Skills + MCP |
| 用户提示 | UserPromptSubmit hook 可注入 issue 上下文 |
| 工具调用 | 直接调用 MCP tools，无额外沙箱 |
| 文件编辑 | 使用 Edit/Write 工具，受 `/freeze` 约束 |

## 同步策略

当 `hosts/claude.ts` 发生变更时，同步更新本文档。
