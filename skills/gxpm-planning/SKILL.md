---
name: gxpm-planning
description: 将计划拆分为可独立抓取的问题（垂直切片），从对话上下文合成 PRD。
---

# Planning

## gxpm-planning

Break any plan into independently-grabbable issues using **tracer-bullet vertical slices**.

### Rules for vertical slices

- Each slice delivers a narrow but **COMPLETE** path through every layer (schema, API, UI, tests).
- A completed slice is demoable or verifiable on its own.
- Prefer many thin slices over few thick ones.

### Slices may be HITL or AFK

- **HITL** — requires human interaction (architectural decision, design review).
- **AFK** — can be implemented and merged without human interaction.
- Prefer AFK over HITL where possible.

### Process

1. **Gather context** — read the plan, spec, or PRD. Fetch from the issue tracker if referenced.
2. **Explore codebase** (optional) — understand current state to inform slice titles.
3. **Draft vertical slices** — break into end-to-end slices, NOT horizontal layers.
4. **Quiz the user** — present as numbered list with:
   - Title
   - Type (HITL / AFK)
   - Blocked by (dependencies)
   - User stories covered
5. **Iterate** until user approves granularity and dependencies.
6. **Publish** — create issues in dependency order (blockers first). Apply `needs-triage` label.

### Issue body template

```markdown
## Parent
Reference to parent issue (if applicable).

## What to build
Concise description of this vertical slice. Describe end-to-end behavior, not layer-by-layer implementation.

## Acceptance criteria
- [ ] Criterion 1
- [ ] Criterion 2

## Blocked by
- Reference to blocking ticket, or "None — can start immediately"
```

## To PRD: Synthesize from Context

Turn the current conversation context into a PRD. Do NOT interview the user — synthesize what you already know.

### PRD Template

```markdown
## Problem Statement
The problem from the user's perspective.

## Solution
The solution from the user's perspective.

## User Stories
1. As an <actor>, I want a <feature>, so that <benefit>
(Extensive list covering all aspects.)

## Implementation Decisions
- Modules to build/modify
- Interfaces to modify
- Schema changes
- API contracts

## Testing Decisions
- What makes a good test (behavior, not implementation)
- Which modules to test

## Out of Scope
Explicitly excluded items.

## Further Notes
Any additional notes.
```

## gxpm integration

- During `plan`, if the `implementation-plan` is too large, use `/planning` to suggest vertical slices as sub-issues.
- Each sub-issue should be created with `gxpm issue create --auto-id`.
- The parent issue's `implementation-plan` should reference child issue IDs.
- For PRD synthesis, publish the PRD as a new issue with `gxpm issue create --auto-id` and label it `needs-triage`.
