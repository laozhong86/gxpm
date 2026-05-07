---
name: gxpm-review-changes
description: Perform a structured code review using change detection and impact
---
<!-- AUTO-GENERATED from SKILL.md.tmpl - do not edit directly -->

## gxpm-review-changes

Perform a thorough, risk-aware code review using GitNexus.

### Steps

1. Run `detect_changes` to map the diff to affected symbols and execution flows.
2. For high-risk symbols, run `impact` with `direction: "upstream"` and `includeTests: true` when useful.
3. Use `context` on key symbols to understand callers, callees, and process participation.
4. Use `query` for broader execution-flow questions raised by the diff.
5. For any untested changes, suggest specific test cases.

### Output Format

Provide findings grouped by risk level (high/medium/low) with:
- What changed and why it matters
- Test coverage status
- Suggested improvements
- Overall merge recommendation

## Token Efficiency Rules
- Start with `detect_changes`, then inspect only the highest-risk symbols.
- Use `impact`/`context` before raw `cypher`.
- Target: complete any review/debug/refactor task in ≤5 graph tool calls.
