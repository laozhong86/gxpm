---
name: gxpm-specifier
type: discipline
description: MUST use during the specify phase before writing behavior-spec and confirming it. BDD behavior specification design skill. Use during gxpm specify phase, when user mentions BDD, Gherkin, Given-When-Then, behavior spec, or behavior-first development.
---

**Announce at start:** "I am using the gxpm-specifier skill to capture domain-level behavior in Gherkin-style scenarios — no test logic, no implementation hints — and to gate transition on user confirmation."

# gxpm-specifier

## Core Principle

**Specify is BDD. Implement is TDD. The two must be separated by a user confirmation.**

在 specify 阶段，**不写一行测试逻辑代码**。产出的仅是 Gherkin 行为注释 + 空函数 stub + 结构化 artifact。

## When to trigger（入口条件）

- gxpm issue 处于 `specify` phase
- 用户要求"先写行为再写代码"、"BDD 先行"、"Given-When-Then"
- `dispatch-handoff.json` 已存在

## Constitution Gate（宪法门）

在 specify 阶段，**CANON.md 是最高权威**。每次生成 spec 前，必须：

1. **读取 CANON.md**，提取与当前 feature 相关的 3-5 条核心纪律
2. **在 spec 开头写入宪法合规声明**：
   ```markdown
   ## Constitution Compliance
   
   本规格遵循 CANON.md 以下条款：
   - Article X: [相关条款摘要]
   - Article Y: [相关条款摘要]
   - ...
   
   任何违反上述条款的实现方案都必须显式说明理由。
   ```
3. **检查清单**（spec 末尾必须包含）：
   - [ ] 没有过工程化（≤3 个核心模块）
   - [ ] 没有过早抽象（直接使用框架能力）
   - [ ] 测试优先（contracts → tests → source）
   - [ ] 无 `[NEEDS CLARIFICATION]` 残留

## [NEEDS CLARIFICATION] 强制标记

遇到以下情况时，**禁止猜测**，必须使用 `[NEEDS CLARIFICATION: 具体问题]` 标记：

- 用户 prompt 未明确的技术栈或架构选择
- 需求中缺失的边界条件、错误处理策略
- 与现有代码风格/模式冲突的实现方式
- 性能、安全、并发等非功能性需求未量化
- 与上游 artifact（acceptance-contract / implementation-plan）不一致的地方

**规则**：
- 每个 `[NEEDS CLARIFICATION]` 必须包含具体的、可回答的问题
- 标记数量 > 3 时，必须暂停生成，向用户呈现所有标记并请求澄清
- 用户澄清后，替换标记为确定内容，不得删除标记不留痕迹

## Hard Rules

```
NO TEST LOGIC IN SPECIFY PHASE
NO IMPLEMENTATION CODE IN SPECIFY PHASE
NO PLACEHOLDER DATA (foo/bar/test/123)
NO SCENARIO WITH > 10 STEPS
NO MIXED CONCERNS IN ONE SCENARIO
NO <placeholder> SENTINEL REMAINS AT CONFIRM TIME
NO CONSTITUTION VIOLATION WITHOUT DOCUMENTED RATIONALE
NO GUESSING — USE [NEEDS CLARIFICATION] INSTEAD
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
7. 直接编辑 `.gxpm/issues/<issue-id>/artifacts/behavior-spec.json`，把所有 `<placeholder>` 替换为真实领域语言（`gxpm specify edit` 命令未实现，请用 $EDITOR 直接打开 JSON 文件）
8. 调用 AskUserQuestion 呈现三选项：
   - 行为正确，继续
   - 需要调整：用户反馈 → 回到步骤 4
   - 补充边界场景：增加 scenario → 回到步骤 4
9. 用户确认后运行 `gxpm specify confirm <issue-id>`

## Red Flags（红旗清单）

立即停止并重新开始：

- 在 specify 阶段写了 `expect` / `assert` 语句
- 用 `foo` / `bar` / `test` 等占位符
- scenario 步骤 > 10
- 一个 scenario 同时测功能 + 性能
- 在 Then 写 UI 选择器、HTTP 状态码（除非接口本身被测）
- 跳过用户确认直接 `gxpm specify confirm`
- 跳过 specify 直接 implement（phase-gate 会拒绝）
- confirm 时 `<placeholder>` 字符串仍残留（`confirmSpecify` 会拒绝）

## Foundational Principle

> Violating the letter of the BDD contract is violating the spirit of behavior-first development. The specify phase exists to capture **what the system should do** in domain language *before* any implementer reasons about *how*. **No exceptions:** smuggling implementation hints into the spec, leaving `[NEEDS CLARIFICATION]` unresolved, or skipping the user confirmation step all collapse the boundary that makes BDD useful. If the spec can't be written without code, the requirements aren't ready — escalate.

## Rationalization Table

| Excuse | Reality |
|---|---|
| "I'll add one tiny `expect` to make the stub runnable." | One `expect` makes specify do TDD's job. The empty stub IS the spec — its emptiness is intentional. |
| "`foo` / `bar` is fine, I'll replace later." | Placeholder data hides domain ambiguity. Real example data forces you to clarify what the domain actually contains. |
| "12 steps in one scenario isn't that bad." | >10 steps means two scenarios were merged. Split them; the merged scenario will fail at review regardless. |
| "The user is busy, I'll skip the confirmation." | Unconfirmed specs become "did the user actually want this?" debates at PR time. The confirmation is the contract. |
| "`[NEEDS CLARIFICATION]` slows things down — I'll just pick something." | Guessed requirements waste the entire implement phase. One paused question costs minutes; a wrong implementation costs days. |

## Verification（验证清单）

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

## Read Next

- `/gxpm-tdd` — red-green-refactor on the spec
- `/gxpm-planning` — incoming plan source
- `/gxpm-prototype` — sanity-check design before specifying

## Terminal State

完成 `behavior-spec` artifact 并 confirm 后：

1. `gxpm specify confirm <issue-id>` 锁定 spec。
2. `gxpm issue transition <issue-id> implement` 进入 implement 阶段。
3. 立即 invoke `gxpm-tdd` 开始 red-green-refactor 循环。

若 spec 含 `<placeholder>` 残留，confirm 会拒绝；先回写真实领域数据再 confirm。
