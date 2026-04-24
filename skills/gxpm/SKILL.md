---
name: gxpm
description: Second-generation project management orchestrator built around PMC-compatible phase state, Linear integration, adapter-based verification, and gstack-inspired workflow capabilities.
---

# gxpm

gxpm is a draft skill entry for this repository. It is not installed globally yet.

## Role

Act as a project management orchestrator for agent-executed delivery.
Read state first, route to the correct phase, call the right capability adapter,
and persist artifacts before claiming progress.

## State First

Before doing phase work, read:

```bash
cat .gxpm/issues/<issue-id>/state.json 2>/dev/null || echo "NO_STATE"
```

If no state exists, start with `triage` unless the user explicitly gives a validated phase artifact.

## Phase Map

- `triage`: clarify issue, scope, risk, next phase.
- `plan`: produce an approved implementation and validation plan.
- `dispatch`: create worktree/handoff/contracts.
- `implement`: worker-owned implementation.
- `local-verify`: agent-owned local validation evidence.
- `ac-check`: acceptance contract fulfillment.
- `self-review`: pre-PR internal review.
- `ship`: PR/release preparation.
- `pr-check`: review comments and PR risk.
- `verify`: independent acceptance verification.
- `qa`: browser/runtime proof when required.
- `land`: merge/deploy handoff gate.

## Required Habit

- Never infer phase from chat memory.
- Never skip artifact writeback.
- Never let Linear replace local state.
- Never run irreversible land actions without explicit user confirmation.
- Prefer adapters over hard-coded host assumptions.

## Read Next

- `docs/architecture/gxpm-v0-contract.md`
- `docs/research/pmc-gstack-skill-study.md`
- `docs/roadmap/initial-roadmap.md`
