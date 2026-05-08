---
name: gxpm-verify
description: Local verification pipeline execution and evidence collection. Use when transitioning from implement to local-verify, or when running the full verification suite for an issue.
---

# gxpm-verify

## The Verification Pipeline

Execute in cost-ascending order. **Stop on first failure.**

```
Step 1: git diff --check          (free — whitespace violations)
Step 2: bun run check             (fast — static analysis + typecheck)
Step 3: bun test                  (medium — unit + integration tests)
Step 4: bun run build             (medium — compilation verification)
```

Only run steps that are relevant to the change:
- Pure test changes: Steps 1–3 are sufficient.
- Build config or type changes: All 4 steps required.
- Documentation only: Step 1 only.

## Evidence Collection

After each step, record:

```json
{
  "verificationSteps": [
    {
      "step": "git-diff-check",
      "command": "git diff --check",
      "exitCode": 0,
      "durationMs": 120,
      "summary": "no whitespace errors"
    },
    {
      "step": "typecheck",
      "command": "bun run check",
      "exitCode": 0,
      "durationMs": 1200,
      "summary": "42 files checked, 0 errors"
    },
    {
      "step": "test",
      "command": "bun test",
      "exitCode": 0,
      "durationMs": 4500,
      "summary": "156 passed, 0 failed"
    },
    {
      "step": "build",
      "command": "bun run build",
      "exitCode": 0,
      "durationMs": 2800,
      "summary": "build succeeded"
    }
  ]
}
```

## Rules

- **No skips.** Every relevant step must execute and pass.
- **Evidence before transition.** `local-verify` artifact is incomplete without `verificationSteps`.
- **Re-run discipline:** Only re-run a step if the code has changed since the last run. Re-running on unchanged code adds no information.

## Failure → Skill Routing

When a step fails, load the right skill to fix it:

| Failed step | Root cause likely | Load this skill |
|-------------|-------------------|-----------------|
| `git diff --check` | Whitespace / trailing space | Fix directly, re-run from Step 1 |
| `bun run check` | Type error, syntax error, lint violation | `/gxpm-build` |
| `bun test` | Test failure, regression, missing coverage | `/gxpm-tdd` |
| `bun run build` | Build script error, dependency issue | `/gxpm-build` |

**Do not fix blindly.** Load the relevant skill, follow its discipline, then re-run the full pipeline from Step 1.

## gxpm Integration

- Load this skill during `implement → local-verify` transition.
- The `local-verify` artifact must contain `verificationSteps` before advancing to `ac-check`.
- If any step fails, fix the issue and re-run the full pipeline from Step 1.
