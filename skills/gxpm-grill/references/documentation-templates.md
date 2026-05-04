### Update CONTEXT.md

When a term is resolved, update `CONTEXT.md` right there. Use this format:

```markdown
## Language

**Issue tracker**:
The tool that hosts a repo's issues — GitHub Issues, Linear, a local markdown convention, or similar.
_Avoid_: backlog manager, backlog backend, issue host

**Issue**:
A single tracked unit of work inside an **Issue tracker**.
_Avoid_: ticket

## Relationships

- An **Issue tracker** holds many **Issues**
- An **Issue** carries one **Triage role** at a time

## Flagged ambiguities

- "backlog" was previously used to mean both the *tool* and the *body of work* — resolved.
```

Create `CONTEXT.md` lazily — only when you have the first term to write. Do not couple it to implementation details; only include terms meaningful to domain experts.

### Offer ADRs sparingly

Only offer to create an ADR when all three are true:

1. **Hard to reverse** — the cost of changing your mind later is meaningful.
2. **Surprising without context** — a future reader will wonder "why did they do it this way?"
3. **The result of a real trade-off** — there were genuine alternatives and you picked one for specific reasons.

If any of the three is missing, skip the ADR. Write ADRs under `docs/adr/` using this format:

```markdown
# ADR-000N: Title

## Status

Accepted

## Context

What is the forcing function? What constraints exist?

## Decision

What are we doing?

## Consequences

What becomes easier? What becomes harder?
```
