# Release SOP

> **Scope:** how to cut and publish a new `@geminix/gxpm` release.
> **Owners:** maintainers with npm publish rights to the `@geminix` scope.
> **Truth source:** `package.json.version` — nothing else. Do not introduce parallel version files.

## TL;DR

```bash
# 1. Make sure main is green and clean
git checkout main && git pull && git status        # working tree must be empty
bun run scripts/gxpm-check.ts && bun test          # both must exit 0

# 2. Bump (creates the commit + the v0.2.0 tag atomically)
npm version minor                                  # patch | minor | major
git push --follow-tags                             # ships commit + tag together

# 3. Publish (prepublishOnly re-runs check + test as a final gate)
npm publish --access public
```

## Why a SOP

GXPM-153/155/162 shipped to users only after this SOP existed. Before it,
versioning was split across `VERSION` (4-segment) and `package.json` (3-segment),
and publishing was done by hand — there was no gate, no tag, no CHANGELOG.
Drift was inevitable. This document and the `prepublishOnly` script close that
gap.

## Hard rules

1. **Single truth.** `package.json.version` is canonical. Anything else
   (CLI `--version` output, doctor report, hook telemetry) reads from
   `package.json` at runtime. There is no `VERSION` file.
2. **Bump via `npm version`.** Never edit `package.json.version` by hand —
   `npm version` writes the bump, creates the matching git tag, and amends
   the commit atomically.
3. **Every published version has a git tag.** `v0.2.0`, `v0.2.1`, ...
   The tag is the audit trail. If you publish without pushing the tag,
   the release is invisible to the repo.
4. **`prepublishOnly` is the gate.** Defined in `package.json.scripts`,
   it runs `bun run scripts/gxpm-check.ts` + `bun test` before npm
   touches the registry. Do not bypass with `--ignore-scripts`.
5. **No publish from a dirty tree.** `git status` must be empty before
   `npm publish`. The `prepublishOnly` script enforces this transitively
   via gxpm-check (which validates skill compliance, version truth, etc.).

## Pre-release checklist

- [ ] On `main`, fully synced (`git pull --ff-only`)
- [ ] Working tree clean (`git status --porcelain` empty)
- [ ] `bun run scripts/gxpm-check.ts` exits 0
- [ ] `bun test` exits 0
- [ ] PRs of the cycle are merged and reflected in `git log`
- [ ] (Optional, recommended) CHANGELOG.md or PR list reviewed

## Bumping

Pick the bump level based on the changes since the last tag:

| Bump | When | Command |
|---|---|---|
| `patch` | Bug fixes only, no API changes | `npm version patch` |
| `minor` | New features, no breaking changes | `npm version minor` |
| `major` | Breaking changes to public CLI / artifact schema / capability contracts | `npm version major` |

`npm version` will:

1. Validate `package.json.version` matches the requested bump rule
2. Update `package.json` to the new version
3. Stage the change and create a commit `0.2.0`
4. Create an annotated git tag `v0.2.0`

If anything in the working tree is dirty, `npm version` aborts. Clean it
first, do not pass `--force`.

## Publishing

```bash
git push --follow-tags                  # push commit + tag
npm publish --access public             # public because @geminix is scoped
```

`--follow-tags` ships the `vX.Y.Z` tag along with the commit so the registry
release matches the repo state. `--access public` is required the first
time you publish under a new scope and is harmless otherwise.

If `prepublishOnly` fails, fix the underlying issue and re-run — do not
escape with `--ignore-scripts`. The script exists to catch drift before
the registry sees it.

## After publish

1. Verify on npm: `npm view @geminix/gxpm versions --json | tail -3`
2. Verify install: `npx @geminix/gxpm@latest --version` should print the new version
3. (Optional) Write a GitHub release note referencing the merged PRs

## Rollback

npm semantics: **you cannot republish the same version**. If a release is
broken:

- For a bad patch / minor: publish the next patch with the fix
  (`npm version patch && git push --follow-tags && npm publish`)
- For a security or data-loss issue: `npm deprecate @geminix/gxpm@X.Y.Z "reason"`
  to warn installers, then publish the fix

Do **not** `npm unpublish`. It is allowed for 72 hours only and breaks every
downstream lockfile that already pinned the version.

## Out of scope (deferred follow-ups)

- Conventional commits + auto CHANGELOG generation (changesets / release-please)
- GitHub Actions tag-trigger publish (so humans never run `npm publish` locally)
- API surface diff to enforce MAJOR bumps on breaking changes
- Pre-release channels (`-beta.N`) workflow

Each of those is worthwhile but out of scope for the initial governance pass.
File a follow-up issue when the friction surfaces.
