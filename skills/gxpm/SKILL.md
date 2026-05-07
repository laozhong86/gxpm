---
name: gxpm
description: 第二代代理项目管理运行时。状态图、能力运行时、阶段门控推进。
---
<!-- AUTO-GENERATED from SKILL.md.tmpl - do not edit directly -->

## gxpm

Target host: OpenAI Codex CLI.

```bash
GXPM_ROOT="${GXPM_ROOT:-$PWD}"
GXPM_STATE_DIR="${GXPM_STATE_DIR:-$GXPM_ROOT/.gxpm}"
export GXPM_ROOT GXPM_STATE_DIR
```

# gxpm

gxpm is a unified project management runtime for agent-executed delivery.
Its product goal is to replace PMC and gstack with one native state graph,
capability runtime, and gate-enforced phase progression — not to wrap them.

## Role

Read state first, route to the correct phase, call the right gxpm capability,
and persist artifacts before claiming progress. Treat `.gxpm/issues/<id>/` as
the single source of truth, not chat memory or Linear comments.

## Quick Reference

```bash
gxpm issue status <issue-id>          # read current phase
gxpm issue next <issue-id>            # recommended next command(s)
gxpm issue context <issue-id>         # full context + resume freshness + required reads + agent instructions (preferred for fresh-session continuation)
gxpm issue list                       # active issues
gxpm issue create --auto-id           # new issue with next free id
gxpm doctor                           # health check
gxpm version                          # installed version
```

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

## Key Rules

### State First

Before doing phase work, read `gxpm issue status <issue-id>`.
If no state exists, create it: `gxpm issue create --auto-id`.

### Canonical State Location

`.gxpm/issues/<id>/` always lives in the **main repository**, never per-worktree.
When working in a worktree, run gxpm commands from the main repo cwd and edit
code in the worktree. Do not create per-worktree `.gxpm/` directories.

### CONTEXT.md Discipline

`CONTEXT.md` is the single source of truth for domain terminology. Update it
inline during `/gxpm-grill` sessions when terms are resolved or sharpened.
Create it lazily — only when the first term needs recording.

### Artifact Discipline

Any non-trivial proposal MUST be written to an artifact before phase transition.
The artifact tree is the source of truth; chat history is volatile.

Use `--probe-cli` when artifact payloads reference concrete CLI commands:

```bash
gxpm artifact write <issue-id> <artifact-type> --probe-cli --json '...'
```

### Worktree Policy

Query the policy before code edits:

```bash
gxpm worktree policy
```

Resolution chain: `config.json` → user message → `AGENTS.md` → default (required, ask).
When `enforcement = required`: always create a worktree. When `forbidden`: never.

In the **dispatch** phase, prepare the workspace before transitioning to implement:

```bash
gxpm workspace ensure <issue-id>
```

- If a git worktree is created or reused, the path is printed. `cd` into it before editing code.
- If the command returns a plain directory (non-git repo), use that directory directly.
- When `enforcement = required` or `default = use`, treat `gxpm workspace ensure` as a mandatory pre-transition step.
- When transitioning `dispatch → implement`, gxpm automatically calls `ensureIssueWorkspaceWithResolver` and updates the `dispatch-handoff` artifact with the resulting `worktreePath` and `worktreeDecision`.

### Checkpoint / Resume

Save handoff state:

```bash
gxpm issue checkpoint <issue-id> --title "handoff" --stdin
```

Resume in a new session (reads the latest checkpoint packet):

```bash
gxpm issue resume <issue-id>
```

Fresh-session continuation with full context + freshness check (preferred):

```bash
gxpm issue context <issue-id>
```

This command returns:
- `confidence`: `fresh`, `stale_resume`, `missing_resume`, or `invalid_resume`
- `confidenceReasons`: why the resume packet is or is not trustworthy
- `requiredReads`: ordered list of files to read before acting
- `agentInstructions`: safe next-step guidance based on confidence
- `next`: the recommended phase transition command

When a prompt mentions an issue id (e.g. "继续 GXPM-42"), the Codex hook
automatically injects `gxpm issue context` output as additional context.

### Codex `update_plan` vs gxpm Phase

Use Codex `update_plan` ONLY for sub-tasks WITHIN the current gxpm phase.
Top-level progression always goes through `gxpm issue transition`.

### Hook Defense

When skill content is unloaded, `gxpm gate` CLI plus git hooks still enforce
phase gates physically. One-shot install:

```bash
gxpm-init --install --target /path/to/repo
```

Escape hatch: `GXPM_GATE_DISABLE=1 git commit ...`

### PR Wait-State Polling

Use a bounded polling script when a `ship`, `pr-check`, or `verify` step is
waiting on CodeRabbit, GitHub checks, or mergeability and the agent should keep
the current Codex CLI turn alive.

```bash
bun run scripts/wait-pr-ready.ts <pr-number-or-url> --timeout-sec 900 --interval-sec 60
```

Exit code contract:

- `0`: review, checks, and merge state are ready. Re-read current-head PR state
  before writing findings or taking the next phase action.
- `1`: blocked by failed checks, conflicts, or requested changes. Write the
  blocker into the current phase artifact.
- `124`: timeout or still pending. Report the latest observed state and stop
  cleanly instead of waiting forever.

Use `--allow-review-required` only when the repository does not require an
approving review decision. Do not use hooks as the wake-up source; hooks only
run after Codex lifecycle events. Do not merge or land from a successful poll
unless the user has explicitly authorized the irreversible action.

### Cleanup After Land

Default: `gxpm cleanup land <issue-id> --execute`.
If retaining the worktree, write `retainWorktreeReason` into `land-findings`.

### Knowledge Boundaries

- Use GitNexus as the default Agent code-intelligence layer for code
  understanding, debugging, refactoring impact, and PR review.
- Treat `gxpm wiki` as an optional human-facing documentation surface for
  onboarding and phase/CLI/governance orientation.
- Do not use wiki freshness as a phase gate. Run `gxpm wiki init/update/query`
  only when a human asks for local project docs or when refreshing those docs
  is the task itself.
- `wiki-context` is a non-gate supporting artifact; it does not replace
  GitNexus impact/debug/review evidence.

## Related Skills

Load the appropriate skill when the task requires it:

- `/gxpm-diagnose` — disciplined debugging loop
- `/gxpm-grill` — alignment session with terminology sharpening
- `/gxpm-tdd` — test-driven development with vertical slices
- `/gxpm-architecture` — architectural friction analysis
- `/gxpm-planning` — PRD synthesis and vertical-slice breakdown
- `/gxpm-triage` — issue state-machine management
- `/gxpm-debug-issue` — GitNexus-powered debugging
- `/gxpm-explore-codebase` — GitNexus-powered architecture exploration
- `/gxpm-refactor-safely` — GitNexus-powered safe refactoring
- `/gxpm-review-changes` — GitNexus-powered change review

For optional human wiki operations, run `gxpm wiki status/init/update/query`.
For browser evidence, load `/gxpm-browser`.

## Read Next

- `docs/architecture/gxpm-replacement-architecture.md`
- `docs/architecture/gxpm-v0-contract.md`
- `docs/governance/development-contract.md`
- `CONTEXT.md`
