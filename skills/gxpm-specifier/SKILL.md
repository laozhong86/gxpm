---
name: gxpm-specifier
description: BDD 行为规约设计 skill。在 gxpm specify 阶段使用，强制先产出 Gherkin 行为注释 + 空测试 stub，由用户确认后才能进入 TDD。触发场景：用户在 specify 阶段、用户提到 BDD、Gherkin、Given-When-Then、行为规约、行为先行。
---

# gxpm-specifier

## Core Principle

**Specify is BDD. Implement is TDD. The two must be separated by a user confirmation.**

在 specify 阶段，**不写一行测试逻辑代码**。产出的仅是 Gherkin 行为注释 + 空函数 stub + 结构化 artifact。

## 入口条件

- gxpm issue 处于 `specify` phase
- 用户要求"先写行为再写代码"、"BDD 先行"、"Given-When-Then"
- `dispatch-handoff.json` 已存在

## Hard Rules

```
NO TEST LOGIC IN SPECIFY PHASE
NO IMPLEMENTATION CODE IN SPECIFY PHASE
NO PLACEHOLDER DATA (foo/bar/test/123)
NO SCENARIO WITH > 10 STEPS
NO MIXED CONCERNS IN ONE SCENARIO
NO <placeholder> SENTINEL REMAINS AT CONFIRM TIME
```

违反任一条 = 删除产出，从 `gxpm specify init` 重新开始。

## 可操作流程

1. 读取上游 artifact：`acceptance-contract`、`implementation-plan`、`dispatch-handoff`
2. 读取治理文档：`docs/governance/gherkin-style.md`
3. 在 `test/` 下找 1-2 个既有测试文件作为风格参照
4. 草拟 Feature + Scenarios（每 scenario `given`/`when`/`then` 各 ≥1 项）
5. 为每个 scenario 生成空 stub：

   ```ts
   // Feature: <title>
   //
   // Scenario (scn-01): <name>
   //   Given <given[0]>
   //   And <given[1]>
   //   When <when>
   //   Then <then[0]>
   //   And <then[1]>

   test("test_<scenario_name_in_snake_case>", () => {
     // intentionally empty — awaiting user confirmation
   });
   ```

6. 运行 `gxpm specify init <issue-id>` 写入 `behavior-spec.json`（自动用 `<placeholder>` 占位）
7. 用 `gxpm specify edit <issue-id>` 或直接编辑 JSON，把所有 `<placeholder>` 替换为真实领域语言
8. 调用 AskUserQuestion 呈现三选项：
   - 行为正确，继续
   - 需要调整：用户反馈 → 回到步骤 4
   - 补充边界场景：增加 scenario → 回到步骤 4
9. 用户确认后运行 `gxpm specify confirm <issue-id>`

## 红旗清单

立即停止并重新开始：

- 在 specify 阶段写了 `expect` / `assert` 语句
- 用 `foo` / `bar` / `test` 等占位符
- scenario 步骤 > 10
- 一个 scenario 同时测功能 + 性能
- 在 Then 写 UI 选择器、HTTP 状态码（除非接口本身被测）
- 跳过用户确认直接 `gxpm specify confirm`
- 跳过 specify 直接 implement（phase-gate 会拒绝）
- confirm 时 `<placeholder>` 字符串仍残留（`confirmSpecify` 会拒绝）

## 验证清单

每次 `gxpm specify confirm` 前自查：

- [ ] 单一行为，可独立执行
- [ ] 无混合关注点
- [ ] 词汇稳定，CONTEXT.md 术语对齐
- [ ] 领域级抽象，无 UI/HTTP/SQL 管道术语
- [ ] 最小但充分的 Given
- [ ] 真实示例数据
- [ ] 第三人称、现在时、主谓结构
- [ ] 严格 Given→When→Then，Then 可观察
- [ ] 步骤数 < 10
- [ ] 每个 scenario.stubPath 真实存在
- [ ] 全文无 `<placeholder>` 残留
- [ ] 用户已通过 AskUserQuestion 或终端确认

## Handoff

`confirmedAt` 写入 → phase 可转 implement → `gxpm-tdd` skill 接管。
