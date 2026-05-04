# Version Drift Recovery

## Problem

`bun run check` reports that `package.json` version does not match the `VERSION` file.

## Root Causes

- Manual edit of one file but not the other
- Merge conflict resolution that left mismatched versions
- Automated tooling that bumped only `package.json`

## Recovery Steps

1. Read both versions:
   ```bash
   cat VERSION
   node -p "require('./package.json').version"
   ```

2. Decide the canonical version:
   - If releasing: update both files to the desired version
   - If the `VERSION` file is the source of truth: sync `package.json` to match
   - If `package.json` is the source of truth: sync `VERSION` to match

3. Apply the fix:
   ```bash
   # Option A: VERSION is canonical
   npm version $(cat VERSION) --no-git-tag-version
   
   # Option B: package.json is canonical
   node -p "require('./package.json').version" > VERSION
   ```

4. Verify:
   ```bash
   bun run check
   ```

5. Commit the change with a `GXPM-N` reference:
   ```bash
   git add VERSION package.json
   git commit -m "chore(GXPM-N): sync version drift"
   ```

## Prevention

- Always run `bun run check` before committing
- The check runs automatically via `gxpm gate` in pre-commit hooks
