# GXPM-111 Test Baseline Debug Notes

## Observations

- `bun test test/install-skill.test.ts --timeout 30000` reproduces a hard failure at `test/install-skill.test.ts:77`.
- The failing assertion expects `gxpm-explore-codebase/scripts/summarize-communities.ts` to be installed.
- `rg --files skills | rg '/scripts/'` returns no skill script files in the current repository.
- `scripts/discover-skills.ts` only reports `scripts/` files that physically exist beside a skill.
- `core/state.ts` and `core/artifacts.ts` fire-and-forget `maybeSyncIssue()` after issue creation, phase transitions, artifact writes, and archive changes.
- `core/issue-sync.ts` resolves sync config through `getConfigValue()`, whose precedence is env -> repo config -> global config. That means ordinary temp-root tests can inherit live Linear sync from the shell or global gxpm config.
- Prior baseline checks showed `issue-list` becomes stable when sync is explicitly disabled, while dedicated `issue-sync.test.ts` passes with repo-local fake Linear config.

## Hypotheses

### H1: Ordinary tests inherit live sync configuration from env/global config (ROOT HYPOTHESIS)

- Supports: issue-heavy tests create many local issues, and issue creation triggers `maybeSyncIssue()` asynchronously.
- Supports: `getConfigValue()` reads env/global config even when a test passes an isolated temp root.
- Supports: disabling sync made `issue-list` stable, while repo-local fake sync tests still pass.
- Conflicts: none found.
- Test: add test-runtime sync isolation so only repo-local `.gxpm/config.json` can enable sync under `NODE_ENV=test`, then rerun `issue-list` and `issue-sync`.

### H2: issue-list itself has inefficient list/archive logic

- Supports: failures concentrate in tests that create many issues.
- Conflicts: the same tests stabilize when sync is disabled, pointing outside list logic.
- Test: rerun `issue-list` after sync isolation without changing list code.

### H3: install-skill implementation dropped script copying

- Supports: failing test is about script installation.
- Conflicts: `discoverScripts()` and `installSkill()` still copy discovered script files; the repository simply has no `skills/**/scripts/*` assets.
- Test: change the stale real-repo expectation and keep script discovery covered by fixture-based tests.

## Experiments

- Reproduced `install-skill.test.ts` failure on the stale hard-coded script path.
- Inspected `discover-skills.ts` and `install-skill.ts`; script install behavior is data-driven and only copies existing files.
- Inspected `issue-sync.ts`, `state.ts`, and `artifacts.ts`; temp-root issue operations can trigger external sync through inherited config.
- After test-runtime sync isolation, `bun test test/issue-list.test.ts --timeout 30000` passed 23 tests in 6.70s.
- After replacing the stale real-repo script assertion with fixture coverage, `bun test test/install-skill.test.ts --timeout 30000` passed 7 tests.
- After adding env/global sync isolation coverage, `bun test test/issue-sync.test.ts --timeout 30000` passed 12 tests.

## Root Cause

The baseline combines two existing drifts: ordinary tests can accidentally inherit live sync configuration despite using temp roots, and `install-skill.test.ts` still expects a skill script file that no longer exists in this repository.

## Fix Plan

- Isolate sync config during `NODE_ENV=test` so env/global sync cannot activate ordinary temp-root tests; allow repo-local sync config for dedicated fake Linear tests.
- Restore environment cleanup in sync tests for all sync-related env vars.
- Replace the stale script expectation in `install-skill.test.ts` with a current contract: references install from the repo, and missing script assets are not invented.
- Verify with focused tests, full `bun test --timeout 30000`, `bun run check`, and `git diff --check`.

## Fix

- `core/issue-sync.ts` now resolves sync values through a test-aware helper. In `NODE_ENV=test`, unless `GXPM_TEST_ALLOW_LIVE_SYNC=1` is set, only repo-local `.gxpm/config.json` can enable sync.
- `test/issue-sync.test.ts` now restores sync-related env vars and verifies env/global sync config is ignored during tests.
- `test/install-skill.test.ts` now keeps repository reference installation coverage and uses a temp fixture to prove script assets are copied when a skill actually owns them.
