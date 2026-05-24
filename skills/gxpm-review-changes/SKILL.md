---
name: gxpm-review-changes
type: technique
description: MUST use during the self-review and pr-check phases before transitioning. Structured code review using change detection and impact analysis. Use when reviewing a pull request, assessing risk before merging, or checking for missing test coverage after changes.
---
<!-- AUTO-GENERATED from SKILL.md.tmpl - do not edit directly -->

**Announce at start:** "I am using the gxpm-review-changes skill to map the diff to symbols and execution flows, surface highest-risk changes first, and produce a structured review-findings record gated on diff impact."

## gxpm-review-changes

Perform a thorough, risk-aware code review using GitNexus.

## When to trigger（入口条件）

- **触发时机**：Use when reviewing a pull request, assessing risk before merging, or checking for missing test coverage after changes.
- **目标**：Perform a thorough, risk-aware code review using GitNexus.

## 可操作流程

1. Run `detect_changes` to map the diff to affected symbols and execution flows.
2. For high-risk symbols, run `impact` with `direction: "upstream"` and `includeTests: true` when useful.
3. Use `context` on key symbols to understand callers, callees, and process participation.
4. Use `query` for broader execution-flow questions raised by the diff.
5. For any untested changes, suggest specific test cases.

## Red Flags（红旗清单 / 反模式）

- Start with `detect_changes`, then inspect only the highest-risk symbols.
- Use `impact`/`context` before raw `cypher`.
- Target: complete any review/debug/refactor task in ≤5 graph tool calls.

## Verification（验证清单 / 出口条件）

Provide findings grouped by risk level (high/medium/low) with:
- What changed and why it matters
- Test coverage status
- Suggested improvements
- Overall merge recommendation

## Read Next

- `/gxpm-review-army` — multi-role parallel review
- `/gxpm` — main project management runtime

## Terminal State

完成本阶段审查 + 写完对应 artifact 后，按 currentPhase 选下一跳：

- `self-review` → `gxpm artifact write <id> self-review --from <file>` + `gxpm issue transition <id> cleanup`，invoke `gxpm-cleanup`。
- `pr-check` → `gxpm artifact write <id> pr-check --from <file>` + `gxpm issue transition <id> verify`，invoke `gxpm-verify` 写 `verify-findings`。

如果发现 P1 / 阻断性问题，先写到 self-review.findings 或 pr-check.reviewFindings，再修补后回到本 skill。
