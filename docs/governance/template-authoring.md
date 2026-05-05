# gxpm Template Authoring

## 目的

gxpm 的 skill 和 capability 文档会逐步由模板生成。本文件规定如何写 `*.tmpl`，避免 prompt 模板变成脆弱脚本。

## 核心原则

- 模板是给代理阅读和执行的 prompt，不是 shell 脚本。
- 用自然语言表达逻辑、状态和决策，不用 shell 变量在代码块之间传递状态。
- 每个 bash 代码块都必须能独立运行；如果需要上下文，在代码块前用 prose 重新说明。
- 分支名、base branch、issue id、worktree 路径都应动态检测或作为占位符，不硬编码。
- 条件分支优先写成编号决策步骤，而不是嵌套 shell if。

## 生成器占位符

当前已支持：

- `{{PREAMBLE}}`：由 host config 注入 host-aware preamble。
- `{{REFERENCE:<name>}}`：注入 `references/<name>.md` 的内容。用于将详细指南、模板、示例从 SKILL.md 中拆分，减少主文件上下文负载。

新增占位符时必须：

1. 在生成器中实现 resolver。
2. 在测试中覆盖成功渲染和漂移检查。
3. 在本文件记录占位符语义。

## 文案规范

- 用短句描述动作和 stop rule。
- 对用户可见输出优先说明结果、证据、剩余风险。
- 不把 PMC/gstack 原始命令直接搬进 gxpm，除非明确标注为上游参考或迁移 adapter。
- 不在默认 skill 里塞大段架构背景；需要深入时链接 `docs/architecture/`。

## Preset 集成

template-authoring.md 定义的占位符在 `gen:skill-docs` 中解析后，还会经过 PresetResolver 的 Override > Preset > Core 三层解析。这意味着：

- 预设可以通过 `replace` 策略完全覆盖生成产物
- 预设可以通过 `append`/`prepend` 策略在生成产物前后注入团队规范
- 覆盖层可以通过 `.gxpm/overrides/` 完全绕过模板系统

预设规则的目标路径是生成产物的输出路径（如 `skills/gxpm/SKILL.md`），不是 `.tmpl` 路径。

## 验证

修改模板后运行：

```bash
bun run gen:skill-docs
bun test
bun run check
```
