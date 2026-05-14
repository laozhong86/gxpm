---
name: gxpm-tdd
description: Test-driven development with red-green-refactor loops via vertical slices. Use when user wants to build features or fix bugs using TDD, mentions 'red-green-refactor', wants integration tests, or asks for test-first development.
---

# Test-Driven Development

## gxpm-tdd

**Core principle**: Tests should verify behavior through public interfaces, not implementation details. Code can change entirely; tests shouldn't.

**Good tests** are integration-style: they exercise real code paths through public APIs. They describe _what_ the system does, not _how_ it does it.

**Bad tests** are coupled to implementation. They mock internal collaborators, test private methods, or verify through external means. The warning sign: your test breaks when you refactor, but behavior hasn't changed.

**Violating the letter of the rules is violating the spirit of the rules.**

## 入口条件

在以下场景触发本 skill：

- 用户要求使用 TDD 构建功能或修复 bug
- 用户提到 "red-green-refactor"
- 用户需要集成测试
- 用户要求测试优先开发

在 gxpm 工作流中，`implement` 阶段应将首个子任务视为 **tracer bullet**，从该任务开始 TDD 循环。

## 可操作流程

### The Iron Law

```
NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST
```

Write code before the test? Delete it. Start over.

**No exceptions:**
- Don't keep it as "reference"
- Don't "adapt" it while writing tests
- Don't look at it
- Delete means delete

Implement fresh from tests. Period.

See [references/red-green-refactor.md](references/red-green-refactor.md) for the full red-green-refactor cycle.

### The Specify-First Iron Law

**Before writing ANY test logic, the test scenario MUST already exist in `.gxpm/issues/<id>/artifacts/behavior-spec.json` with `confirmedAt` set.**

If you find yourself writing a test without a corresponding entry in `behavior-spec.json`:

- STOP
- Delete the test code you wrote
- Return to specify phase: `gxpm phase rewind <id> --to specify --reason "missing scenario"`
- Run `gxpm specify revise <id>` to clear `confirmedAt`
- Add the scenario to `behavior-spec.json`
- Re-confirm with `gxpm specify confirm <id>`
- Then resume TDD

**Why:** BDD describes WHAT behavior we want; TDD enforces THAT behavior incrementally. Jumping to TDD without a confirmed BDD spec means the agent is inventing test cases — the precise failure mode this discipline prevents.

**The test stub file at `scenario.stubPath` is your contract.** Open it; the Gherkin comment block at the top is the only legitimate source of assertions you may translate into code.

### 正确做法：垂直切片（Vertical Slices）

**DO NOT write all tests first, then all implementation.** This is "horizontal slicing" — treating RED as "write all tests" and GREEN as "write all code."

This produces **crap tests**:
- Tests written in bulk test _imagined_ behavior, not _actual_ behavior
- You end up testing the _shape_ of things rather than user-facing behavior
- Tests become insensitive to real changes

**Correct approach**: Vertical slices via tracer bullets.

```
WRONG (horizontal):
  RED:   test1, test2, test3, test4, test5
  GREEN: impl1, impl2, impl3, impl4, impl5

RIGHT (vertical):
  RED→GREEN: test1→impl1
  RED→GREEN: test2→impl2
  RED→GREEN: test3→impl3
  ...
```

See [references/workflow.md](references/workflow.md) for the full TDD workflow.

### 卡壳时的应对策略

| Problem | Solution |
|---------|----------|
| Don't know how to test | Write wished-for API. Write assertion first. Ask your human partner. |
| Test too complicated | Design too complicated. Simplify interface. |
| Must mock everything | Code too coupled. Use dependency injection. |
| Test setup huge | Extract helpers. Still complex? Simplify design. |

### 调试集成

Bug found? Write failing test reproducing it. Follow TDD cycle. Test proves fix and prevents regression.

Never fix bugs without a test.

### 添加 mock 或测试工具时

Read `@testing-anti-patterns.md` before adding mocks, changing tests, or adding test-only methods to production code.

## Red Flags / 红旗清单 / 反模式

### 必须立即停止并重新开始的情况

- Code before test
- Test after implementation
- Test passes immediately
- Can't explain why test failed
- Tests added "later"
- Rationalizing "just this once"
- "I already manually tested it"
- "Tests after achieve the same purpose"
- "It's about spirit not ritual"
- "Keep as reference" or "adapt existing code"
- "Already spent X hours, deleting is wasteful"
- "TDD is dogmatic, I'm being pragmatic"
- "This is different because..."
- Writing a test without a matching scenario in `behavior-spec.json`
- Adding assertions that do not appear in the scenario's `then` clauses

**All of these mean: Delete code. Start over with TDD.**

### 水平切片（Horizontal Slices）

一次性写完全部测试再写全部实现是水平切片，会产生脆弱且脱离实际的测试。必须按垂直切片逐个 RED→GREEN→REFACTOR 推进。

## 验证清单 / 出口条件

每个 TDD 循环完成后检查：

```
[ ] Test describes behavior, not implementation
[ ] Test uses public interface only
[ ] Test would survive internal refactor
[ ] Code is minimal for this test
[ ] No speculative features added
[ ] Verify RED executed (test failed for expected reason)
[ ] Verify GREEN executed (test passes + all others pass + output clean)
```

### Final Rule

```
Production code → test exists and failed first
Otherwise → not TDD
```

No exceptions without your human partner's permission.

### 验证与证据

单个 TDD 循环的测试验证由测试运行器覆盖。全部 TDD 循环完成后，加载 `/gxpm-verify` 运行完整验证流水线并收集 `local-verify` 证据。

在 gxpm 工作流中：
- 使用 `gxpm run event <issue-id> <run-id> --type test-passed` 记录测试里程碑。
- TDD 循环完成后，加载 `/gxpm-verify` 执行完整验证流水线并产出 `local-verify` 证据。
- 如果在 TDD 过程中发现 bug，先写重现该 bug 的 failing test。仅当根因不明时才切换到 `/gxpm-diagnose` skill。

## 常见说辞表

| Excuse | Reality |
|--------|---------|
| "Too simple to test" | Simple code breaks. Test takes 30 seconds. |
| "I'll test after" | Tests passing immediately prove nothing. |
| "Tests after achieve same goals" | Tests-after = "what does this do?" Tests-first = "what should this do?" |
| "Already manually tested" | Ad-hoc ≠ systematic. No record, can't re-run. |
| "Deleting X hours is wasteful" | Sunk cost fallacy. Keeping unverified code is technical debt. |
| "Keep as reference, write tests first" | You'll adapt it. That's testing after. Delete means delete. |
| "Need to explore first" | Fine. Throw away exploration, start with TDD. |
| "Test hard = design unclear" | Listen to test. Hard to test = hard to use. |
| "TDD will slow me down" | TDD faster than debugging. Pragmatic = test-first. |
| "Manual test faster" | Manual doesn't prove edge cases. You'll re-test every change. |
| "Existing code has no tests" | You're improving it. Add tests for existing code. |
