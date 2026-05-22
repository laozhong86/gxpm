# GXPM Verification Checklist

Run these checks after installing or upgrading gxpm to confirm everything works.

## Check #1: Runtime

```bash
gxpm doctor --json
```

Expected: `status` is `healthy` or `warnings`. `health_score` >= 80.

If `status` is `error`, run `gxpm doctor --fix` and retry.

### Business-state health (GXPM-197)

`gxpm doctor` covers the install/config surface only. For the in-flight issue
surface — dangling worktrees, stalled phases, missing phase-exit artifacts, and
unacknowledged phase handoffs — run:

```bash
gxpm doctor issues --json
gxpm doctor issues --since 7d        # only look at issues touched in the last week
gxpm doctor issues --fix             # conservative: removes dangling worktrees + writes audit log
gxpm doctor issues --fix-aggressive  # reserved for future destructive fixes; currently a no-op warn
```

Checks emitted (independent `schema_version: 1`):

| Check | Meaning |
|-------|---------|
| `dangling_worktree` | Worktree directory survives after the owning issue archived/landed |
| `phase_stale` | Issue has been in a phase longer than the configured threshold |
| `missing_artifact` | Current phase lacks the artifact required to transition out |
| `handoff_broken` | Next phase was entered but the `phase-handoff` artifact was never acknowledged |

Override the phase-stale thresholds (days) per phase via:

```bash
gxpm config set doctor.issues.phase_threshold.specify 14
```

`--fix` writes one JSON line per action to `~/.gxpm/audit/doctor-issues-fixes.jsonl`.

## Check #2: CLI Commands

```bash
gxpm --version
gxpm config list
gxpm session-id
```

All should return valid output without error.

## Check #3: Git Hooks

Make any commit in a repo where gxpm hooks are installed:

```bash
git commit --allow-empty -m "test: verify gxpm hooks"
```

The commit should succeed. If pre-commit fails, check `.githooks/gxpm-pre-commit` output.

## Check #4: Issue Lifecycle

```bash
gxpm issue create --auto-id
```

Note the created issue ID (e.g., `GXPM-123`). Then:

```bash
gxpm issue transition GXPM-123 plan
gxpm issue transition GXPM-123 dispatch
gxpm issue transition GXPM-123 implement
```

Each transition should succeed. Inspect `.gxpm/issues/GXPM-123/state.json` to confirm phase progression.

## Check #5: Worktree (if worktree.enforcement != forbidden)

```bash
git worktree add ../test-worktree main
```

Should succeed. Clean up:

```bash
git worktree remove ../test-worktree
```

## Check #6: Linear Sync (if configured)

If `sync.provider` is `linear`:

```bash
gxpm doctor --json | jq '.checks[] | select(.name=="linear_connectivity")'
```

Expected: `status: "ok"`. If `warn`, check `LINEAR_API_KEY` env var.

Create an issue and confirm it appears in Linear (may take a few seconds):

```bash
gxpm issue create --auto-id
gxpm issue sync <id>
```

## Check #7: Skill Host Discovery

```bash
gxpm doctor --json | jq '.checks[] | select(.name=="skill_installation")'
```

Expected: `status: "ok"`. If `warn`, run:

```bash
gxpm init --install-skill --host all
```

## One-Command Smoke Test

```bash
gxpm verify
```

This runs all checks above (except Check #6 which requires manual confirmation in Linear UI). Result should be `passed`.
