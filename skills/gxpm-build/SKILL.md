---
name: gxpm-build
description: Compile and type-check verification. Use after implementing code changes, before committing, or when the build fails and root cause is unclear.
---

# gxpm-build

## Verify Build

After every code change, run in this order:

```bash
# 1. Type check (fastest, catch type errors first)
bun run check

# 2. Build (confirm compilation produces valid output)
bun run build
```

If the project uses a different build system, substitute the equivalent commands.

### Exit Code Contract

| Exit Code | Meaning | Action |
|-----------|---------|--------|
| 0 | Success | Proceed |
| non-0 | Failure | **Stop. Fix before continuing.** |

## Rules

- **Never commit broken build.** A build failure means implementation is incomplete.
- **Type errors are behavior errors.** Type checking is not optional polish — it is contract verification.
- **Incremental compilable:** After every increment (even partial), the project must build successfully.
- **One fix at a time:** If build fails, fix the root cause before running the build again. Do not guess-and-rerun.

## Build Failure Attribution

| Symptom | Likely Cause | Fix Strategy |
|---------|-------------|--------------|
| Type error in changed file | Incorrect type usage or missing property | Fix the type, not the test |
| Type error in unchanged file | Breaking change leaked to consumer | Update consumer or revert breaking change |
| Syntax error | Typo, missing brace, invalid syntax | Fix syntax, re-run typecheck first |
| Build output missing | Build script misconfigured or dependency missing | Check `package.json` scripts and `node_modules` |
| Module resolution error | Import path wrong or alias unconfigured | Verify path mapping in `tsconfig.json` |

## gxpm Integration

- During `implement`, run build verification after every vertical slice.
- Before leaving `implement`, the `local-verify` artifact must include `buildEvidence`:

```json
{
  "buildEvidence": {
    "commands": ["bun run check", "bun run build"],
    "exitCodes": [0, 0],
    "timestamp": "2026-05-08T08:30:00Z"
  }
}
```
