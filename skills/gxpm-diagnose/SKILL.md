---
name: gxpm-diagnose
description: Disciplined diagnosis loop for hard bugs and performance regressions. Use when user says 'diagnose this', reports a hard bug, describes a performance regression, or asks why something fails.
---
<!-- AUTO-GENERATED from SKILL.md.tmpl - do not edit directly -->

# Diagnose

A discipline for hard bugs where the root cause is **not yet known**.

## 入口条件

**Skill boundary:**
- If you have a **specific symptom, stack trace, or error message** and need to trace its root cause through the codebase, load `/gxpm-debug-issue` first.
- If you need to **understand code structure** without debugging a specific bug, load `/gxpm-explore-codebase` first.
- If you are **refactoring** and discover a bug mid-refactor, switch to `/gxpm-diagnose` or `/gxpm-debug-issue` instead of continuing.

- **触发时机**：Use when user says 'diagnose this', reports a hard bug, describes a performance regression, or asks why something fails.
- **纪律**：Skip phases only when explicitly justified.

## 可操作流程

### Phase 1 — Build a feedback loop

**This is the skill.** Everything else is mechanical. If you have a fast, deterministic, agent-runnable pass/fail signal for the bug, you will find the cause — bisection, hypothesis-testing, and instrumentation all just consume that signal. If you don't have one, no amount of staring at code will save you.

Spend disproportionate effort here. **Be aggressive. Be creative. Refuse to give up.**

See [references/feedback-loops.md](references/feedback-loops.md) for the full catalog of 10 loop construction strategies.

#### Iterate on the loop itself

Treat the loop as a product. Once you have _a_ loop, ask:

- Can I make it faster? (Cache setup, skip unrelated init, narrow the test scope.)
- Can I make the signal sharper? (Assert on the specific symptom, not "didn't crash".)
- Can I make it more deterministic? (Pin time, seed RNG, isolate filesystem, freeze network.)

A 30-second flaky loop is barely better than no loop. A 2-second deterministic loop is a debugging superpower.

#### Non-deterministic bugs

The goal is not a clean repro but a **higher reproduction rate**. Loop the trigger 100×, parallelise, add stress, narrow timing windows, inject sleeps. A 50%-flake bug is debuggable; 1% is not — keep raising the rate until it's debuggable.

#### When you genuinely cannot build a loop

Stop and say so explicitly. List what you tried. Ask the user for: (a) access to whatever environment reproduces it, (b) a captured artifact (HAR file, log dump, core dump, screen recording with timestamps), or (c) permission to add temporary production instrumentation. Do **not** proceed to hypothesise without a loop.

Do not proceed to Phase 2 until you have a loop you believe in.

### Phase 2 — Reproduce

Run the loop. Watch the bug appear.

Confirm:

- [ ] The loop produces the failure mode the **user** described — not a different failure that happens to be nearby. Wrong bug = wrong fix.
- [ ] The failure is reproducible across multiple runs (or, for non-deterministic bugs, reproducible at a high enough rate to debug against).
- [ ] You have captured the exact symptom (error message, wrong output, slow timing) so later phases can verify the fix actually addresses it.

Do not proceed until you reproduce the bug.

### Phase 3 — Explore with the codebase

Use available code intelligence tools (e.g., GitNexus MCP, grep, ReadFile) to accelerate understanding:

1. **Semantic search** to find code related to the symptom.
2. **Call-chain tracing** to follow `callers_of` / `callees_of` relationships.
3. **Execution flow analysis** to see full paths through suspected areas.
4. **Change detection** (`git diff`, `detect_changes`) to check if recent changes caused the issue.
5. **Impact analysis** on suspected files to see what else is affected.

**Token efficiency**: start with the narrowest context possible, then expand. Target ≤5 tool calls and ≤800 total output tokens for the exploration phase.

### Phase 4 — Hypothesise

Generate **3–5 ranked hypotheses** before testing any of them. Single-hypothesis generation anchors on the first plausible idea.

Each hypothesis must be **falsifiable**: state the prediction it makes.

> Format: "If <X> is the cause, then <changing Y> will make the bug disappear / <changing Z> will make it worse."

If you cannot state the prediction, the hypothesis is a vibe — discard or sharpen it.

**Show the ranked list to the user before testing.** They often have domain knowledge that re-ranks instantly ("we just deployed a change to #3"), or know hypotheses they've already ruled out. Cheap checkpoint, big time saver. Don't block on it — proceed with your ranking if the user is AFK.

### Phase 5 — Instrument

Each probe must map to a specific prediction from Phase 4. **Change one variable at a time.**

Tool preference:

1. **Debugger / REPL inspection** if the env supports it. One breakpoint beats ten logs.
2. **Targeted logs** at the boundaries that distinguish hypotheses.
3. Never "log everything and grep".

**Tag every debug log** with a unique prefix, e.g. `[DEBUG-a4f2]`. Cleanup at the end becomes a single grep. Untagged logs survive; tagged logs die.

**Perf branch.** For performance regressions, logs are usually wrong. Instead: establish a baseline measurement (timing harness, `performance.now()`, profiler, query plan), then bisect. Measure first, fix second.

### Phase 6 — Fix + regression test

Write the regression test **before the fix** — but only if there is a **correct seam** for it.

A correct seam is one where the test exercises the **real bug pattern** as it occurs at the call site. If the only available seam is too shallow (single-caller test when the bug needs multiple callers, unit test that can't replicate the chain that triggered the bug), a regression test there gives false confidence.

**If no correct seam exists, that itself is the finding.** Note it. The codebase architecture is preventing the bug from being locked down. Flag this for the next `/gxpm-architecture` run.

If a correct seam exists:

1. Turn the minimised repro into a failing test at that seam.
2. Watch it fail.
3. Apply the fix.
4. Watch it pass.
5. Re-run the Phase 1 feedback loop against the original (un-minimised) scenario.

### Phase 7 — Cleanup + post-mortem

Required before declaring done:

- [ ] Original repro no longer reproduces (re-run the Phase 1 loop)
- [ ] Regression test passes (or absence of seam is documented)
- [ ] All `[DEBUG-...]` instrumentation removed (`grep` the prefix)
- [ ] Throwaway prototypes deleted (or moved to a clearly-marked debug location)
- [ ] The hypothesis that turned out correct is stated in the commit / PR message — so the next debugger learns

**Then ask: what would have prevented this bug?** If the answer involves architectural change (no good test seam, tangled callers, hidden coupling) hand off to the `/gxpm-architecture` skill with the specifics. Make the recommendation **after** the fix is in, not before — you have more information now than when you started.

## 红旗清单 / 反模式

- **STOP：没有 feedback loop 就进入 Phase 2。** 如果没有可运行的 pass/fail 信号，停下来明确说明，向用户求助。
- **STOP：单假设测试。** 在测试前必须生成 3-5 个排名假设，否则容易锚定在第一个看似合理的想法上。
- **STOP：log everything and grep。** 只加针对性的日志，每个探针必须对应一个具体假设的预测。
- **STOP：性能回归先加日志。** 性能问题先建立基线测量，然后二分，不是先加日志。
- **STOP：在没有 correct seam 的地方写回归测试。** 这会给虚假信心。
- **危险信号：** "The bug is obvious, no need to reproduce." → 明显的 bug 跳过复现最危险。
- **危险信号：** "I'll just log everything and grep." → 这是调试反模式，会淹没信号。
- **危险信号：** "This test seam is too shallow but I'll write the test anyway." → 没有 correct seam 时，缺失 seam 本身就是发现，应标记为架构问题。

## 验证清单 / 出口条件

- [ ] Phase 1 feedback loop 已建立且可信（快速、确定性强、可自动化运行）。
- [ ] Phase 2 已复现 bug，且捕获了精确症状。
- [ ] Phase 3 已使用代码智能工具完成探索（≤5 tool calls 目标）。
- [ ] Phase 4 已生成 3-5 个可证伪的排名假设，并已向用户展示。
- [ ] Phase 5 每次只改变一个变量，每个探针映射到具体假设预测。
- [ ] Phase 6 regression test 在 fix 之前已写（如果有 correct seam）。
- [ ] Phase 7 所有 `[DEBUG-...]` 日志已清理，原型已删除。
- [ ] Post-mortem 问题已回答："什么能预防这个 bug？"

**失败时路由**
- 架构问题导致无 correct seam → `/gxpm-architecture`
- 需要代码定位根因 → `/gxpm-debug-issue`
- 需要代码结构理解 → `/gxpm-explore-codebase`

## 常见说辞表

| 用户 utterance / 借口 | 推荐回应 |
|-----------------------|----------|
| "这个 bug 很明显，不用复现。" | "明显的 bug 跳过复现最危险。复现能验证假设，也是调试的基础。请先建立 feedback loop。" |
| "我先加一堆日志看看。" | "建议先生成 3-5 个假设，再针对性地加日志。'log everything' 会淹没信号，降低效率。" |
| "性能问题肯定是数据库慢。" | "性能回归需要先建立基线测量，再二分定位。直觉往往是错的，数据不会。" |
| "这个测试 seam 太浅了，但先写吧。" | "如果 seam 无法复现真实 bug 模式，回归测试会给虚假信心。建议标记为架构问题，后续用 /gxpm-architecture 解决。" |
| "我已经修好了，不用写回归测试。" | "没有回归测试 = 没有证据。同样的 bug 会在未来以不同形式回来。请写测试。" |
