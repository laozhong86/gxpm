---
name: gxpm-refactor-safely
type: technique
description: Plan and execute safe refactoring using dependency analysis. Use when user asks to rename, extract, split, move, or simplify code, or when a code review suggests refactoring.
---

**Announce at start:** "I am using the gxpm-refactor-safely skill to plan a rename, extract, split, or move using the dependency graph so the refactor preserves call-site semantics."

## gxpm-refactor-safely

## When to trigger（入口条件）

**Skill boundary:**
- If you do **not yet understand** the target code, load `/gxpm-explore-codebase` first.
- If you discover a **bug** during refactoring, stop refactoring and load `/gxpm-diagnose` or `/gxpm-debug-issue`.
- If you need to **rename or move** symbols across the codebase, confirm the `rename` tool is available in your GitNexus MCP; otherwise use manual renaming with `detect_changes` validation.

Use GitNexus to plan and execute refactoring with confidence. When simplifying code, follow the scan-checklist-incremental-verify loop below.

## 可操作流程

1. **Understand** — Use `impact` with `direction: "upstream"`, `query`, and `context` to understand the target code, its callers, edge cases, and test coverage before touching it.
2. **Scan for simplification opportunities** (checklist):
   - **Deep nesting (>3 levels)** → guard clauses or extracted helpers
   - **Long functions (>50 lines or >1 responsibility)** → split by responsibility
   - **Nested ternaries** → if/else, early-return, or switch
   - **Generic names** (`data`, `tmp`, `x`) → descriptive names
   - **Duplicated logic (same pattern ≥2 times)** → shared function or constant
   - **Dead code** (unused imports, unreachable branches, stale comments) → remove after confirming with `impact`/`context`
3. **For renames**, use `rename` with `dry_run: true` to preview all affected locations.
4. **Apply each simplification incrementally** — run tests after **every** narrow edit:
   - Use the project's test command (e.g. `bun test`, `npm test`).
   - If tests fail, **revert that change immediately** and reconsider.
   - Only proceed to the next simplification when the current one is green.
5. **After all changes**, run `detect_changes` to verify the refactoring impact, ensure the build succeeds, and keep the diff clean.

## Red Flags（红旗清单 / 反模式）

**Safety Checks**
- Always preview before applying (rename mode gives you an edit list).
- Check `impact` before major refactors.
- Use `detect_changes` to ensure affected flows are expected.
- Use `cypher` only for custom graph questions that `query`/`context` cannot answer.

**Protected Blocks**

Some code must not be simplified even if it looks complex. Respect block-level protection annotations in any language:

```js
/* gxpm-simplify-ignore-start: perf-critical */
// manually unrolled XOR — 3x faster than a loop
result[0] = buf[0] ^ key[0];
result[1] = buf[1] ^ key[1];
/* gxpm-simplify-ignore-end */
```

Supported comment styles: `//`, `/* */`, `#`, `<!-- -->`. The `reason` field is optional but recommended. Never modify, rename, or delete code inside a protected block.

- Start with the narrowest GitNexus query or impact target, then expand.
- Prefer dry-run previews for coordinated renames.

## Verification（验证清单 / 出口条件）

- run `detect_changes` to verify the refactoring impact, ensure the build succeeds, and keep the diff clean.
- Target: complete any review/debug/refactor task in ≤5 graph tool calls.

## Read Next

- `/gxpm-review-changes` — verify post-refactor scope
- `/gxpm-architecture` — find consolidation opportunities
- `/gxpm-explore-codebase` — understand call-graph first
