# gxpm Shared Language (CONTEXT.md)

> This file is the single source of truth for domain terminology used across the gxpm project.
> Update it inline during `/grill` sessions when terms are resolved or sharpened.

## Language

**Issue tracker**:
The tool that hosts a repo's issues — GitHub Issues, Linear, a local `.gxpm/issues/` markdown convention, or similar.
_Avoid_: backlog manager, backlog backend, issue host

**Issue**:
A single tracked unit of work inside an **Issue tracker** — a bug, task, PRD, or slice produced by `/planning`.
_Avoid_: ticket (use only when quoting external systems that call them tickets)

**Triage role**:
A canonical state-machine label applied to an **Issue** during triage (e.g. `needs-triage`, `ready-for-agent`). Each role maps to a real label string in the **Issue tracker** via `docs/agents/triage-labels.md`.

**Phase**:
A canonical stage in the gxpm delivery pipeline: `triage` → `plan` → `dispatch` → `implement` → `local-verify` → `ac-check` → `self-review` → `ship` → `pr-check` → `verify` → `qa` → `land`.

**Artifact**:
A machine-readable JSON document persisted under `.gxpm/issues/<id>/artifacts/`. Each phase transition requires a specific artifact type as gate evidence.

**Worktree**:
A git worktree used to isolate feature branch development from the canonical main checkout.

**Claim**:
A soft-state lock indicating which session is currently executing an issue. Not a write lock — ownership records the latest writing session for hook warnings.

**Skill**:
A reusable agent capability loaded by the host (Codex/Claude). Each skill is a self-contained directory with a `SKILL.md` file. gxpm skills live under `skills/` and are installed to the host's skill directory.

## Relationships

- An **Issue tracker** holds many **Issues**
- An **Issue** carries one **Triage role** at a time
- An **Issue** progresses through one **Phase** at a time
- A **Phase** transition requires one **Artifact**
- A **Session** may **Claim** one **Issue** at a time

## Flagged ambiguities

- "backlog" was previously used to mean both the *tool* hosting issues and the *body of work* inside it — resolved: the tool is the **Issue tracker**; "backlog" is no longer used as a domain term.
- "backlog backend" / "backlog manager" — resolved: collapsed into **Issue tracker**.
