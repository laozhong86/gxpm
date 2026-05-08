---
name: gxpm-debug-issue
description: Systematic issue debugging using graph-powered code navigation. Use when user asks to trace a bug, investigate a specific error, or find the root cause of a failing test or exception.
---
<!-- AUTO-GENERATED from SKILL.md.tmpl - do not edit directly -->

## gxpm-debug-issue

**Skill boundary:**
- If the root cause is **completely unknown** and you need a systematic diagnosis loop, load `/gxpm-diagnose` first.
- If you need to **understand code structure** without debugging a specific bug, load `/gxpm-explore-codebase` first.
- If you are **refactoring**, load `/gxpm-refactor-safely` instead.

Use GitNexus to systematically trace and debug issues when you have a **specific symptom**.

### Steps

1. Run `list_repos` and read `gitnexus://repo/{name}/context` when an index exists.
2. Use `query` to find execution flows related to the symptom.
3. Use `context` on suspected symbols to inspect callers, callees, and participating processes.
4. Run `detect_changes` to check if recent changes caused the issue.
5. Use `impact` on suspected symbols or files to see what else is affected.

### Tips

- Check both callers and callees to understand the full context.
- Look at affected flows to find the entry point that triggers the bug.
- Recent changes are the most common source of new issues.

## Token Efficiency Rules
- Start with the narrowest GitNexus query that matches the symptom, then expand.
- Prefer `query` and `context` before raw `cypher`.
- Target: complete any review/debug/refactor task in ≤5 graph tool calls.
