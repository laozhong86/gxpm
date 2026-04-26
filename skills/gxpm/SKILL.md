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

gxpm is a unified project management runtime for agent-executed delivery.
Its product goal is to replace PMC and gstack with one native state graph,
capability runtime, and gate-enforced phase progression — not to wrap them.

## Role

Read state first, route to the correct phase, call the right gxpm capability,
and persist artifacts before claiming progress. Treat `.gxpm/issues/<id>/` as
the single source of truth, not chat memory or Linear comments.

## State First

Before doing phase work, read:

```bash
gxpm issue status <issue-id>
```

To see all tracked issues at once:

```bash
gxpm issue list             # active issues (hides land + archived)
gxpm issue list --all       # everything including landed/archived
gxpm issue list --archived  # only archived
gxpm issue list --json      # machine-readable
```

To stash a finished or abandoned issue out of the active list:

```bash
gxpm issue archive <issue-id>     # hide from default list
gxpm issue unarchive <issue-id>   # restore to default list
```

To check if gxpm is correctly installed in this machine + this repo:

```bash
gxpm doctor               # human-readable report with ✓ / ✗ + fix commands
gxpm doctor --json        # machine-readable
gxpm version              # print installed version (also: --version / -v)
```

When unsure what to run next on a specific issue:

```bash
gxpm issue next <issue-id>   # prints recommended next command(s)
```

To audit an issue's full history (gates, transitions, artifact writes):

```bash
gxpm issue history <issue-id>           # human timeline
gxpm issue history <issue-id> --json    # machine-readable
```

If no state exists, create it before phase work:

```bash
gxpm issue create <issue-id>
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
gxpm artifact read <issue-id> ship-readiness
gxpm artifact read <issue-id> pr-check
gxpm artifact read <issue-id> verify-findings
gxpm artifact read <issue-id> qa-findings
gxpm artifact read <issue-id> land-findings
```

Before leaving `triage`, initialize `acceptance-contract`:

```bash
gxpm triage init <issue-id>
```

Before leaving `plan`, initialize `implementation-plan`:

```bash
gxpm plan init <issue-id>
```

Before leaving `dispatch`, initialize `dispatch-handoff`:

```bash
gxpm dispatch init <issue-id>
```

Before leaving `implement`, initialize `local-verify`:

```bash
gxpm implement verify <issue-id>
```

Before leaving `local-verify`, initialize `acceptance-check`:

```bash
gxpm local-verify ac-check <issue-id>
```

Before leaving `ac-check`, initialize `self-review`:

```bash
gxpm ac-check self-review <issue-id>
```

Before leaving `self-review`, initialize `ship-readiness`:

```bash
gxpm self-review ship <issue-id>
```

Before leaving `ship`, initialize `pr-check`:

```bash
gxpm ship pr-check <issue-id>
```

Before leaving `pr-check`, initialize `verify-findings`:

```bash
gxpm pr-check verify <issue-id>
```

Before leaving `verify`, initialize `qa-findings`:

```bash
gxpm verify qa <issue-id>
```

Before leaving `qa`, initialize `land-findings`:

```bash
gxpm qa land <issue-id>
```

V0 phase transitions are strict. Use `gxpm issue transition <issue-id> <next-phase>` only for the next phase in the phase map. `triage -> plan` is blocked until `acceptance-contract` exists. `plan -> dispatch` is blocked until `implementation-plan` exists. `dispatch -> implement` is blocked until `dispatch-handoff` exists. `implement -> local-verify` is blocked until `local-verify` exists. `local-verify -> ac-check` is blocked until `acceptance-check` exists. `ac-check -> self-review` is blocked until `self-review` exists. `self-review -> ship` is blocked until `ship-readiness` exists. `ship -> pr-check` is blocked until `pr-check` exists. `pr-check -> verify` is blocked until `verify-findings` exists. `verify -> qa` is blocked until `qa-findings` exists. `qa -> land` is blocked until `land-findings` exists.

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

## Populating Artifact Content

`gxpm <phase> init` writes an empty draft. Use `gxpm artifact write` (CLI)
or `gxpm artifact edit` ($EDITOR) to put real content in:

```bash
# CLI input (scripts / agents)
gxpm artifact write <issue-id> acceptance-contract --json '{"criteria":[...]}'
gxpm artifact write <issue-id> implementation-plan --from ./plan.json
cat payload.json | gxpm artifact write <issue-id> verify-findings --stdin

# Interactive editor (humans)
EDITOR=vim gxpm artifact edit <issue-id> acceptance-contract
```

JSON-only on purpose — the artifact contract is machine-readable.

## Codex Runtime Hooks (Layer 4, optional)

Codex CLI v0.117.0+ supports lifecycle hooks. gxpm ships two:

- `SessionStart` — injects active issue list + resume hints when a Codex
  session opens, so the agent always knows what's in flight.
- `UserPromptSubmit` — when the user mentions a `GXPM-N` / `GXG-N` issue id
  in their prompt, gxpm injects that issue's current phase + next-step
  guidance.

Install:

```bash
gxpm-init --install-codex-hooks --scope user      # ~/.codex/hooks/
gxpm-init --install-codex-hooks --scope repo --target /path  # <repo>/.codex/hooks/
```

Then enable the feature flag in `~/.codex/config.toml`:

```toml
[features]
codex_hooks = true
```

Restart Codex to activate.

## Hook Defense (Layer 3)

When skill content is unloaded by progressive disclosure, the `gxpm gate` CLI
plus git hooks still enforce phase gates physically.

One-shot install in target repo (skill globally + hooks in repo):

```bash
gxpm-init --install --target /path/to/repo
```

Or install separately:

```bash
gxpm-init --install-skill --host all              # SKILL.md to ~/.codex/.claude/...
gxpm-init --install-hooks --target /path/to/repo  # git hooks in target repo
```

This copies four hook templates to `<repo>/.githooks/`:

- `gxpm-pre-commit` — blocks commits to protected paths (`apps/`, `server/`, `packages/`, `scripts/`, `tests/`, `supabase/`, `e2e/`) when `currentPhase` is not in `{dispatch, implement, local-verify, ac-check, self-review, ship, pr-check, verify}`.
- `gxpm-commit-msg` — requires every commit message to reference a `GXG-NNN` or `GXPM-NNN` issue.
- `gxpm-pre-push` — refuses to push when the current phase's required artifact is missing.
- `gxpm-post-merge` — auto-initializes `land-findings` and transitions `qa → land` when a feature branch merges.

Manual gate check (the hooks call these under the hood):

```bash
gxpm gate pre-commit <issue-id> --staged "<file1> <file2> ..."
gxpm gate commit-msg <msg-file> --issue <issue-id>
gxpm gate pre-push <issue-id>
gxpm gate post-merge <issue-id>
```

Exit code 0 = allowed; exit 1 = blocked with stderr explanation.

Escape hatch for legitimate exceptions:

```bash
GXPM_GATE_DISABLE=1 git commit ...
```

All four gate commands respect this env var. Use sparingly and document why.

## Read Next

- `docs/architecture/gxpm-replacement-architecture.md`
- `docs/architecture/gxpm-v0-contract.md`
- `docs/architecture/scaffold-northstar.md`
- `docs/governance/development-contract.md`
- `docs/governance/template-authoring.md`
- `docs/governance/host-adapter.md`
- `docs/research/pmc-gstack-skill-study.md`
- `docs/roadmap/initial-roadmap.md`
