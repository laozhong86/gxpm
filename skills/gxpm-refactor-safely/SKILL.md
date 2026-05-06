---
name: Refactor Safely
description: Plan and execute safe refactoring using dependency analysis
---
<!-- AUTO-GENERATED from SKILL.md.tmpl - do not edit directly -->

## Refactor Safely

Use GitNexus to plan and execute refactoring with confidence.

### Steps

1. Use `impact` with `direction: "upstream"` before changing shared symbols.
2. Use `query` and `context` to understand execution flows and symbol relationships.
3. For renames, use `rename` with `dry_run: true` to preview all affected locations.
4. Apply narrow edits only after reviewing the preview or impact result.
5. After changes, run `detect_changes` to verify the refactoring impact.

### Safety Checks

- Always preview before applying (rename mode gives you an edit list).
- Check `impact` before major refactors.
- Use `detect_changes` to ensure affected flows are expected.
- Use `cypher` only for custom graph questions that `query`/`context` cannot answer.

## Token Efficiency Rules
- Start with the narrowest GitNexus query or impact target, then expand.
- Prefer dry-run previews for coordinated renames.
- Target: complete any review/debug/refactor task in ≤5 graph tool calls.
