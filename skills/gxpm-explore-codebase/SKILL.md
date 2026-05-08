---
name: gxpm-explore-codebase
description: Navigate and understand codebase structure using the knowledge graph. Use when user asks how code works, wants to understand architecture, trace execution flows, or explore unfamiliar parts of the codebase.
---

## gxpm-explore-codebase

**Skill boundary:**
- If you are debugging a **specific bug or error**, load `/gxpm-debug-issue` or `/gxpm-diagnose` instead.
- If you are **refactoring** code you do not yet understand, load this skill first, then `/gxpm-refactor-safely`.

Use available code intelligence tools (e.g., GitNexus MCP, grep, ReadFile) to explore and understand the codebase.

### Steps

1. Run `list_repos` to discover indexed repositories.
2. Run `query` with natural language to find execution flows and symbols.
3. Use `context` on a specific symbol for 360-degree view (callers, callees, references).
4. Use `impact` before making changes to analyze blast radius.
5. Use `route_map` and `shape_check` to understand API consumption patterns.

### Tips

- Start broad (repo list, architecture) then narrow down to specific areas.
- Use `cypher` for complex structural queries against the knowledge graph.
- Use `detect_changes` to map git diffs to affected execution flows.

## Token Efficiency Rules
- ALWAYS start with the narrowest query possible, then expand.
- Use compact output modes when available. Only escalate to full dumps when necessary.
- Target: complete any review/debug/refactor task in ≤5 tool calls and ≤800 total output tokens.
