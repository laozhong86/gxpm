---
name: gxpm-feedback
description: Create feedback issues in the gxpm source repository when the agent discovers problems or improvement opportunities during gxpm workflow execution. Use when the agent notices a gxpm bug, process flaw, skill deficiency, or has a suggestion for the gxpm tool itself.
---

# gxpm Feedback

Create structured feedback issues in the gxpm source repository so that problems and improvements are tracked, triaged, and eventually resolved.

## 入口条件

**何时触发**
- 代理在执行 gxpm 流程时发现 gxpm **自身**的 bug 或缺陷。
- 代理发现 gxpm 流程、阶段门控、或 skill 设计存在可改进之处。
- 代理遇到 gxpm CLI 报错、意外行为、或边界情况未处理。
- 代理认为某个 skill 的指令存在歧义、遗漏、或反模式未覆盖。
- 代理发现文档（CANON.md、AGENTS.md、CONTEXT.md、governance docs）与代码实现不一致。

**前置条件**
- `feedback.gxpmSourceRoot` 已配置（指向 gxpm 源码仓库的绝对路径）。
- 代理已识别问题的具体表现和影响范围。

**Skill 边界（什么情况下应该加载别的 skill）**
- 需要调试定位根因 → `/gxpm-debug-issue`
- 需要提交代码修复 → `/gxpm-implementer`
- 需要架构讨论 → `/gxpm-grill`
- 只是对当前业务 issue 有疑问 → 在当前 skill 内解决，不要创建 feedback issue

## 可操作流程

### 1. 判断是否应该创建反馈 issue

在以下情况**不要**创建 feedback issue：
- 问题是当前业务项目的代码问题，不是 gxpm 工具本身的问题。
- 问题只是代理对 gxpm 流程不熟悉（先查文档，确认确实是缺陷再反馈）。
- 问题是暂时性的网络/环境故障，不可复现。

### 2. 选择反馈分类

| 分类 | 说明 | 对应 issueType |
|---|---|---|
| `bug` | gxpm CLI 崩溃、状态机异常、artifact 丢失、同步失败等 | `meta` |
| `enhancement` | 新功能请求、现有功能扩展 | `feature` |
| `process` | 流程改进、阶段门控调整、skill 结构优化 | `meta` |
| `documentation` | 文档与代码不一致、文档缺失、术语模糊 | `meta` |

默认 issueType 为 `meta`（轻量级 rigor）。如果是较大的功能请求，用 `feature`。

### 3. 收集反馈内容

在创建 issue 前，收集以下信息：

1. **What** — 具体发现了什么问题或有什么建议（一句话概括）。
2. **Context** — 在哪个阶段、执行什么命令、使用什么 skill 时发现的。
3. **Reproduction** — 如果是 bug，提供复现步骤或相关日志片段。
4. **Impact** — 这个问题对 gxpm 流程的影响程度（阻塞 / 困扰 / 轻微）。
5. **Suggestion** — 建议的修复方向或改进方案（可选但推荐）。

### 4. 创建反馈 issue

使用 CLI 命令：

```bash
gxpm feedback create --auto-id \
  --title "<一句话标题>" \
  --description "<详细描述>" \
  --type meta
```

参数说明：
- `--auto-id`：自动分配下一个可用 ID（推荐）。
- `--title`：简洁的问题/建议标题（50 字以内）。
- `--description`：包含 What / Context / Reproduction / Impact / Suggestion 的完整描述。
- `--type`：`meta`（默认，流程/文档/小缺陷）、`feature`（功能请求）、`spike`（需要调研）。

命令执行后，会返回创建的 issue ID 和在 gxpm 源码目录中的 statePath。

### 5. 记录溯源信息（可选但推荐）

如果当前正在处理某个业务 issue，在业务 issue 的 memory 或 evidence 中记录：

```markdown
## Feedback Created
- 反馈 issue: `<gxpm-source-issue-id>`
- 原因: <简要说明>
- 创建时间: <ISO 时间>
```

这有助于后续审计时理解为什么当时创建了反馈。

## 红旗清单 / 反模式

- **STOP：把业务 bug 当成 gxpm bug。** 如果问题是当前项目代码导致的，修复业务代码，不要创建 gxpm feedback issue。
- **STOP：空标题或空描述。** 没有上下文的 feedback issue 对维护者毫无价值；必须包含 Context 和 Impact。
- **STOP：重复反馈。** 创建前先检查 gxpm 源码目录 `.gxpm/issues/` 中是否已有相似标题或描述的 issue。
- **STOP：在 feedback issue 中讨论业务实现。** Feedback issue 只讨论 gxpm 工具本身。
- **危险信号：** "这个问题很小，不值得记录。" → 小问题的积累会腐蚀流程纪律。只要确认是 gxpm 的缺陷，就应该记录。
- **危险信号：** "我现在就顺便修了。" → 如果代理在执行业务 issue 时顺手修 gxpm，会导致业务范围蔓延。创建 feedback issue，让修复走独立的 gxpm 流程。

## 验证清单 / 出口条件

- [ ] 确认问题是 gxpm 工具本身的问题，不是业务项目的问题。
- [ ] 已检查是否存在重复反馈。
- [ ] 反馈包含完整的 What / Context / Impact（Reproduction 和 Suggestion 视情况）。
- [ ] 已成功执行 `gxpm feedback create` 并拿到 issue ID。
- [ ] （可选）在当前业务 issue 的 memory 中记录了反馈溯源。
- [ ] feedback issue 已自动进入 `triage` 阶段，等待 gxpm 维护者分类。

**失败时路由**
- `feedback.gxpmSourceRoot` 未配置 → 提示用户配置：`gxpm config set feedback.gxpmSourceRoot </absolute/path>`
- 不确定是 gxpm bug 还是业务 bug → `/gxpm-debug-issue` 先定位根因
- 反馈内容需要架构讨论 → `/gxpm-grill`

## 常见说辞表

| 用户/代理 utterance | 推荐回应 |
|---|---|
| "gxpm 又报错了，是不是 bug？" | "先确认报错是 gxpm CLI/流程导致的，还是当前项目代码导致的。如果是 gxpm 本身的问题，收集 Context 和 Reproduction，然后创建 feedback issue。" |
| "这个 skill 的指令好像有问题。" | "具体哪里有问题？是指令歧义、边界未覆盖、还是与代码实现不一致？确认后创建 feedback issue，附上建议的修改方向。" |
| "我觉得 gxpm 应该增加某某功能。" | "这是个 enhancement 建议。用 `gxpm feedback create --type feature --title ... --description ...` 记录，描述中要包含使用场景和预期行为。" |
| "这个问题太小了，不值得记录。" | "小问题不记录会积累成流程债务。只要确认是 gxpm 缺陷，就值得一个 feedback issue。" |
| "我在跑业务 issue，顺便把 gxpm 这个 bug 修了吧。" | "不要范围蔓延。创建 feedback issue 记录它，让修复走独立的 gxpm 流程，保证业务 issue 的聚焦。" |
