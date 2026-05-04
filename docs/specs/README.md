# docs/specs/

Host 平台规范镜像的存放目录。

## 目的

将各 AI host 平台（Claude、Codex、Cursor 等）的规范、约束和适配要求以结构化文档形式沉淀，确保新会话可快速恢复 host 上下文，减少跨平台行为漂移。

## 命名规范

采用平台名称命名：

- `claude.md` — Claude Code / Claude Desktop 规范
- `codex.md` — OpenAI Codex CLI 规范
- `cursor.md` — Cursor IDE 规范
- `kimi.md` — Kimi Code CLI 规范（如适用）

## 内容约定

- 平台标识与版本范围
- 支持的上下文长度与格式
- 工具调用约定（MCP、hooks、skills）
- 已知限制与 workaround
- 与 gxpm 的集成点

## 同步策略

specs/ 文档应与 `hosts/` 代码目录保持同步。当 host adapter 发生变更时，需同步更新对应 spec 文档。
