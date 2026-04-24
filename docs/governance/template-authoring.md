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

新增占位符时必须：

1. 在生成器中实现 resolver。
2. 在测试中覆盖成功渲染和漂移检查。
3. 在本文件记录占位符语义。

## 文案规范

- 用短句描述动作和 stop rule。
- 对用户可见输出优先说明结果、证据、剩余风险。
- 不把 PMC/gstack 原始命令直接搬进 gxpm，除非明确标注为上游参考或迁移 adapter。
- 不在默认 skill 里塞大段架构背景；需要深入时链接 `docs/architecture/`。

## 验证

修改模板后运行：

```bash
bun run gen:skill-docs
bun test
bun run check
```
