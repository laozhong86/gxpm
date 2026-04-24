# gxpm Development Contract

## 目的

本文件把 gstack 中有效的开发规范转成 gxpm 的可执行合同。`AGENTS.md` 保持薄入口，本文件作为开发、验证、提交和失败归因的渐进加载规则。

## 命令分层

| Tier | Command | 何时运行 | 目标 |
| --- | --- | --- | --- |
| fast | `bun test` | 每次实现后、提交前 | 免费静态验证和单元测试 |
| gate | `bun run check` | 提交前、生成器或 governance 改动后 | host config、生成文档和治理文档检查 |
| generated | `bun run gen:skill-docs` | 修改 `*.tmpl`、host config、preamble 后 | 刷新生成的 skill surface |
| future-e2e | 待实现 | browser/runtime capability 落地后 | 真实浏览器和 agent workflow 证据 |
| future-eval | 待实现 | 高风险 prompt/capability 改动 | LLM judge 或 paid eval，需先确认成本 |

## 生成物规则

- `SKILL.md.tmpl` 是真值，`SKILL.md` 是生成产物。
- 修改模板后必须运行 `bun run gen:skill-docs` 并提交模板与生成物。
- 生成物冲突只能通过模板和生成器解决，再重新生成。
- `bun run check` 必须能发现生成物漂移。

## 失败归因协议

不要直接说“这是旧问题”或“与本次无关”。需要满足以下任一证据：

1. 同一命令在 base/main 上也失败。
2. 有仓库已有记录证明该失败是基线噪声。
3. 无法验证时，明确标记为“未验证，可能相关”，并把风险写进汇报。

## 提交规则

- 每个提交只表达一个逻辑变化。
- 模板改动和生成物刷新可以同一提交，但不要混入无关重构。
- 测试基础设施、host adapter、产品文档变更应尽量独立，便于回滚。
- 提交前至少运行 `bun test`、`bun run check`、`git diff --check`。

## Live Install 风险

未来 gxpm 支持本地 `.agents/` 或 `.claude/` dev install 后，修改模板和生成器可能立即影响其他会话。大改前先确认：

- 当前 host skill 是 symlink 还是 copy。
- 是否有并行会话依赖当前安装。
- 是否需要先切回稳定全局安装或隔离 worktree。

## 长任务规则

长时间测试、E2E、浏览器验证和部署验证必须持续轮询到结束。不能把“后台会通知”当作完成证据。每次轮询只汇报新进展、失败和下一步。

## 文档边界

- `AGENTS.md` 只放不可推断的执行边界。
- `CLAUDE.md` 只放 Claude Code 启动差异。
- 专项规则放 `docs/governance/`，不要把所有细节塞回根文件。
