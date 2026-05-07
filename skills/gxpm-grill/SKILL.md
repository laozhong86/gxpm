---
name: gxpm-grill
description: 对照领域模型质疑计划、精炼术语、内联更新 CONTEXT.md 和 ADR。
---
<!-- AUTO-GENERATED from SKILL.md.tmpl - do not edit directly -->

# Grill

Interview the user relentlessly about every aspect of a plan until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one.

## gxpm-grill

- Before leaving `triage` — when issue scope is unclear or involves new domain concepts.
- During `plan` — when implementation decisions need fleshing out.
- Any time the user says "grill me", "let's align", or describes a design without details.

## Process

### 1. Ask one question at a time

Wait for feedback on each question before continuing. If a question can be answered by exploring the codebase, explore the codebase instead.

### 2. Challenge against the glossary

When the user uses a term that conflicts with the existing language in `CONTEXT.md`, call it out immediately:

> "Your glossary defines 'cancellation' as X, but you seem to mean Y — which is it?"

### 3. Sharpen fuzzy language

When the user uses vague or overloaded terms, propose a precise canonical term:

> "You're saying 'account' — do you mean the Customer or the User? Those are different things."

### 4. Discuss concrete scenarios

When domain relationships are being discussed, stress-test them with specific scenarios. Invent scenarios that probe edge cases and force the user to be precise about boundaries between concepts.

### 5. Cross-reference with code

When the user states how something works, check whether the code agrees. If you find a contradiction, surface it:

> "Your code cancels entire Orders, but you just said partial cancellation is possible — which is right?"


## Documentation side effects

As decisions crystallise, update project documentation inline. Do not batch these up — capture them as they happen.

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


## gxpm integration

- Before leaving `triage`, use grilling to clarify issue scope and write the `acceptance-contract`.
- During `plan`, use grilling to resolve implementation decisions and write the `implementation-plan`.
- Record any ADR created during grilling in the issue's artifact history via `gxpm artifact write`.
