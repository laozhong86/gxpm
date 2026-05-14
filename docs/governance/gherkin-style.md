# Gherkin 写作风格指南 (v1)

> 本文档源自 AutomationPanda/gherkin-guidelines-for-ai (MIT)，加 gxpm 本地补充。
> 所有 gxpm-driven issue 在 specify 阶段必须遵循本规则集。

## 核心原则

- **行为驱动**：描述系统*做什么*而非*怎么做*
- **领域语言**：使用 CONTEXT.md 中的术语，不出现 UI/HTTP/SQL 等技术词
- **示例规约**：scenario 用具体例子展示行为
- **每个 scenario 一个行为**
- **可独立执行**：scenario 之间无顺序依赖

## Feature 结构

- 单一 `Feature:` 标题与文件名一致
- User Story 紧跟标题：
  - `As a <role>`
  - `I want <goal>`
  - `So that <reason>`

## Scenario 设计规则

- 单行、行为聚焦的标题
- 步骤可按时间顺序执行
- 声明式语言，非命令式
- 不混合多个无关关注点（功能 + 性能 + 可访问性必须拆分）
- 步骤数 < 10，超过用 data table

## Given / When / Then 语义

- `Given` 建立上下文（Arrange）
- `When` 触发动作（Act）
- `Then` 验证可观察结果（Assert）

**严格顺序**：`Given → When → Then`，禁止重复阶段。

**关键词**：
- `And` 续相同类型（OK）
- `But` 用于对比（少用）
- **禁止 `Or`** —— 拆 Scenario Outline 或独立 scenario

**可观察结果**：`Then` 必须可从场景文本验证。禁止 "it works"、"it succeeds" 这类模糊断言；必须说出"发生了什么"、"用户看到什么"、"系统报告什么"。

## 词汇与命名

- 整个 issue 内使用稳定词汇，禁止同义词替换
- 第三人称、现在时、主谓结构
- 字符串参数用双引号
- 步骤数据用 doc string (`"""`) 或 data table，禁止用 `And` 串联

## 反模式（禁止）

- 在 Given/When/Then 写入 UI 选择器、XPath、`click #id`
- 在 Then 写 SQL 断言、HTTP 状态码（除非这就是被测的接口）
- 占位符数据：`foo`、`bar`、`test`、纯数字 `123`（数字若有业务含义可用）
- 一个 scenario 多个行为
- 步骤超过 10 个
- 把"用户登录"描述成 10 步点击；改用状态："用户已以 Editor 身份登录"

## gxpm 本地补充

- **中文允许**：领域词允许中文，但同一 issue 内保持中英一致
- **必须引用 CONTEXT.md 术语**：scenario 中提及的实体名必须在 CONTEXT.md 中有定义；新词需先扩展 CONTEXT.md
- **stubPath 必须真实**：每个 scenario 的 `stubPath` 字段指向的测试文件必须存在
- **scenario.id 命名**：`scn-NN`（两位数字补零）
- **禁止 `<placeholder>` 留存**：specifier 草拟阶段允许 `<placeholder>` 字符串占位，但 `gxpm specify confirm` 会拒绝任何残留 placeholder 的 spec

## Pre-confirm 自查清单

specifier agent 在调用 `gxpm specify confirm` 前必须自查：

- [ ] 单一行为，可独立执行
- [ ] 无混合无关关注点
- [ ] 词汇稳定，CONTEXT.md 术语对齐
- [ ] 领域级抽象，无 UI/HTTP/SQL 管道术语
- [ ] 最小但充分的 Given
- [ ] 真实示例数据（无 foo/bar/test）
- [ ] 第三人称、现在时、主谓结构
- [ ] 严格 Given → When → Then，Then 可观察
- [ ] 步骤数 < 10
- [ ] 每个 scenario.stubPath 真实存在
- [ ] 全文无 `<placeholder>` 残留

## 参考

- [AutomationPanda/gherkin-guidelines-for-ai](https://github.com/AutomationPanda/gherkin-guidelines-for-ai)（一手规则源）
- `CONTEXT.md`（领域词典）
- `docs/brainstorms/2026-05-14-bdd-then-tdd-design.md`（设计 spec）
- `docs/plans/bdd-then-tdd-plan.md`（实施计划）
