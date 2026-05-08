---
name: gxpm-hygiene
description: Pre-commit hygiene and atomic commit discipline. Use before every commit, or when preparing changes for self-review or ship.
---

# gxpm-hygiene

## Pre-Commit Checklist

Run in order before every commit. **Do not duplicate work already done by `gxpm-verify` or `gxpm-build`.**

```bash
# 1. Review what you're about to commit
git diff --staged

# 2. Secret leak scan (manual review)
git diff --staged --name-only | xargs grep -l "\.env" 2>/dev/null || true
# Also review diff for high-entropy strings that look like keys/tokens

# 3. Confirm atomicity — one logical change
git diff --staged --stat
```

**Why no `bun run check` / `bun test` / `bun run build` here?**
These are the responsibility of `gxpm-build` (during development) and `gxpm-verify` (at the `local-verify` gate). Running them in hygiene creates redundant cycles and blurs accountability. Hygiene focuses on **git-layer discipline**: what you are about to commit, not whether the code works.

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
