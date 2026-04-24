---
name: gxpm
description: Second-generation project management product designed to replace PMC and gstack with one native state graph, capability runtime, browser evidence layer, and agent delivery workflow.
---
<!-- AUTO-GENERATED from SKILL.md.tmpl - do not edit directly -->

## Host Preamble

Target host: OpenAI Codex CLI.

```bash
GXPM_ROOT="${GXPM_ROOT:-$PWD}"
GXPM_STATE_DIR="${GXPM_STATE_DIR:-$GXPM_ROOT/.gxpm}"
export GXPM_ROOT GXPM_STATE_DIR
```

# gxpm

gxpm is a draft skill entry for this repository. It is not installed globally yet.
Its product goal is to replace PMC and gstack, not wrap them.

## Role

Act as a unified project management runtime for agent-executed delivery.
Read state first, route to the correct phase, call the right gxpm capability,
and persist artifacts before claiming progress.

## State First

Before doing phase work, read:

```bash
gxpm issue status <issue-id>
```

If no state exists, create it before phase work:

```bash
gxpm issue create <issue-id>
```

Before leaving `triage`, initialize the acceptance contract:

```bash
gxpm triage init <issue-id>
```

Inspect artifacts when gate evidence matters:

```bash
gxpm artifact list <issue-id>
gxpm artifact read <issue-id> acceptance-contract
gxpm artifact read <issue-id> implementation-plan
gxpm artifact read <issue-id> dispatch-handoff
gxpm artifact read <issue-id> local-verify
gxpm artifact read <issue-id> acceptance-check
gxpm artifact read <issue-id> self-review
```

Before leaving `plan`, initialize the implementation plan:

```bash
gxpm plan init <issue-id>
```

Before leaving `dispatch`, initialize the dispatch handoff:

```bash
gxpm dispatch init <issue-id>
```

Before leaving `implement`, initialize local verification evidence:

```bash
gxpm implement verify <issue-id>
```

Before leaving `local-verify`, initialize acceptance fulfillment evidence:

```bash
gxpm local-verify ac-check <issue-id>
```

Before leaving `ac-check`, initialize self-review evidence:

```bash
gxpm ac-check self-review <issue-id>
```

V0 phase transitions are strict. Use `gxpm issue transition <issue-id> <next-phase>` only for the next phase in the phase map. `triage -> plan` is blocked until `acceptance-contract` exists. `plan -> dispatch` is blocked until `implementation-plan` exists. `dispatch -> implement` is blocked until `dispatch-handoff` exists. `implement -> local-verify` is blocked until `local-verify` exists. `local-verify -> ac-check` is blocked until `acceptance-check` exists. `ac-check -> self-review` is blocked until `self-review` exists.

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
- Treat PMC/gstack as upstream references, not final runtime dependencies.
- Prefer gxpm native capabilities over hard-coded host assumptions.

## Read Next

- `docs/architecture/gxpm-replacement-architecture.md`
- `docs/architecture/gxpm-v0-contract.md`
- `docs/architecture/scaffold-northstar.md`
- `docs/governance/development-contract.md`
- `docs/governance/template-authoring.md`
- `docs/governance/host-adapter.md`
- `docs/research/pmc-gstack-skill-study.md`
- `docs/roadmap/initial-roadmap.md`
