# gxpm Installation Guide for AI Agents

Read this entire file, then follow the steps. Target: ~10 minutes to a fully working project management runtime.

## Step 0: If you are not Claude Code

Read `AGENTS.md` at the repo root first. It's the non-Claude-agent operating protocol (install, read order, trust boundary, common tasks). Claude Code reads `CLAUDE.md` automatically and can skip ahead.

If you fetched this file by URL without cloning yet, the companion files live at:
- `https://raw.githubusercontent.com/laozhong86/gxpm/main/AGENTS.md` — start here
- `https://raw.githubusercontent.com/laozhong86/gxpm/main/CONTEXT.md` — shared language / glossary

## Step 1: Install gxpm

```bash
git clone https://github.com/laozhong86/gxpm.git ~/gxpm && cd ~/gxpm
curl -fsSL https://bun.sh/install | bash
export PATH="$HOME/.bun/bin:$PATH"
bun install && bun link
```

Verify: `gxpm --version` should print a version number. If `gxpm` is not found, restart the shell or add the PATH export to the shell profile.

## Step 2: Initialize a Project

Navigate to the project you want to manage with gxpm (or stay in `~/gxpm` to manage gxpm itself):

```bash
cd /path/to/your/project
gxpm init
```

This will:
1. Create `.gxpm/` directory structure
2. Install git hooks (pre-commit, commit-msg, pre-push, post-merge, post-checkout)
3. Install Codex hooks (if `.codex/` detected)
4. Install gxpm skills to all detected host adapters (Claude, Codex, Cursor)
5. Initialize `.gxpm/config.json` with sensible defaults
6. Inject two `nexus` npm scripts into the target repo's `package.json` (if present) so GitNexus indexing has a canonical entry point that does not modify versioned `AGENTS.md` / `CLAUDE.md` blocks:
   - `npm run nexus` → `gitnexus analyze --skip-agents-md` (everyday indexing)
   - `npm run nexus:full` → `gitnexus analyze` (full indexing including doc stats refresh)

   Already-customized `scripts.nexus` is never overwritten. Pass `--skip-nexus-script` to opt out entirely.

For non-interactive / CI mode:
```bash
gxpm init --non-interactive --target /path/to/project
```

## Step 3: Configure

Review and adjust configuration:

```bash
gxpm config list
```

Key settings to consider:
- `sync.provider`: `linear`, `github`, or `none`
- `sync.linearTeamId` / `sync.linearTeamKey`: if using Linear
- `worktree.enforcement`: `optional` (default), `required`, or `forbidden`

Set via:
```bash
gxpm config set sync.provider linear
gxpm config set sync.linearTeamId your-team-uuid --global
```

## Step 4: Verify

Run the verification suite:

```bash
gxpm doctor --json
gxpm verify
```

All checks should pass. If any fail, follow the remediation hints printed.

## Step 5: Create Your First Issue

```bash
gxpm issue create --auto-id
```

Follow the triage flow. The issue state will be persisted under `.gxpm/issues/<id>/`.

## Step 6: Load Skills

Read `skills/gxpm/SKILL.md`. This is the skill dispatcher. It tells you which skill to read for any task. Save this to your memory permanently.

The three most important skills to adopt immediately:

1. **gxpm-triage** — intake and classify incoming work
2. **gxpm-planning** — scope confirmation and implementation planning
3. **gxpm** — master dispatch for issue lifecycle, phase gates, and artifact management

## Step 7: Recurring Jobs

Set up using your platform's scheduler:

- **Auto-update check** (daily): `gxpm-update-check` (tell user, never auto-install)
- **Weekly health check**: `gxpm doctor --json && gxpm verify`

## Upgrade

```bash
cd ~/gxpm && git pull origin main && bun install
gxpm upgrade
```

Then read `docs/migrations/v*.md` for any versions you skipped and run any backfill steps listed.

## Troubleshooting

- `gxpm doctor --fix` auto-repairs common issues (missing hooks, stale skill docs)
- `gxpm doctor --json` gives machine-readable output for agent consumption
- Read `docs/GXPM_VERIFY.md` for the full verification checklist
