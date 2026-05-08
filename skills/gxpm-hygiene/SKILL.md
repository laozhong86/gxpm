---
name: gxpm-hygiene
description: Pre-commit hygiene and atomic commit discipline. Use before every commit, or when preparing changes for self-review or ship.
---

# gxpm-hygiene

## Pre-Commit Checklist

Run in order before every commit:

```bash
# 1. Review what you're about to commit
git diff --staged

# 2. Secret leak scan
git diff --staged | grep -i "password\|secret\|api_key\|token"

# 3. Static checks
bun run check

# 4. Tests
bun test

# 5. Build
bun run build

# 6. Confirm atomicity — one logical change
git diff --staged --stat
```

## Atomic Commit Rules

- **One logical change per commit.** Do not mix refactoring, features, and unrelated cleanups.
- **Generated files:** If `.tmpl` was modified, `bun run gen:skill-docs` must run first.
- **Issue reference:** Commit message must include `GXPM-N` reference.
- **Worktree discipline:** Main checkout stays on `main`. Feature work happens in dedicated worktrees.

## Red Flags — STOP

- Committing with `--no-verify` to bypass checks
- Build or tests failing at commit time
- Missing `GXPM-N` reference in commit message
- One commit mixing refactor + feature + cleanup
- Uncommitted generated files after modifying templates
- Committing secrets or `.env` files
- Running the same check twice without code changes in between

## gxpm Integration

- Run this checklist before every commit during `implement`.
- `self-review` phase must confirm all commits followed this hygiene.
- `ship` phase uses this checklist as part of PR preparation.
