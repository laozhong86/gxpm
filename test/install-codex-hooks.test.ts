import { describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { installCodexHooks } from "../scripts/install-codex-hooks";

const repoRoot = resolve(import.meta.dir, "..");

function runSessionStart(script: string, cwd: string, env: Record<string, string> = {}) {
  return Bun.spawnSync({
    cmd: ["bash", script],
    stdin: new TextEncoder().encode(
      JSON.stringify({ session_id: "x", cwd, hook_event_name: "SessionStart" }),
    ),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, GXPM_UPDATE_CHECK_BIN: "/does/not/exist", ...env },
  });
}

function readAdditionalContext(stdout: string) {
  return JSON.parse(stdout).hookSpecificOutput.additionalContext as string;
}

function createGxpmRepo(root: string, options: { schema?: number; version?: string } = {}) {
  mkdirSync(join(root, ".gxpm", "issues"), { recursive: true });
  mkdirSync(join(root, "core"), { recursive: true });
  writeFileSync(
    join(root, "core", "state.ts"),
    `export const CURRENT_SCHEMA_VERSION = ${options.schema ?? 1};\n`,
  );
  if (options.version !== undefined) {
    writeFileSync(join(root, "VERSION"), `${options.version}\n`);
  }
}

describe("installCodexHooks", () => {
  test("default scope is 'repo' (writes to <target>/.codex/)", () => {
    const fakeRepo = mkdtempSync(join(tmpdir(), "gxpm-codex-default-"));
    const result = installCodexHooks({ target: fakeRepo, gxpmRoot: repoRoot });
    expect(result.rootDir).toBe(join(fakeRepo, ".codex"));
    expect(existsSync(join(fakeRepo, ".codex", "hooks.json"))).toBe(true);
  });

  test("user scope: writes scripts to ~/.codex/hooks/ and hooks.json", () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "gxpm-codex-hooks-user-"));

    const result = installCodexHooks({ scope: "user", home: fakeHome, gxpmRoot: repoRoot });

    expect(result.installedScripts.length).toBe(3);
    expect(result.installedScripts.every((p) => p.includes(".codex/hooks/gxpm-"))).toBe(true);
    expect(existsSync(join(fakeHome, ".codex", "hooks", "gxpm-session-start.sh"))).toBe(true);
    expect(existsSync(join(fakeHome, ".codex", "hooks", "gxpm-user-prompt-submit.sh"))).toBe(true);
    expect(existsSync(join(fakeHome, ".codex", "hooks", "gxpm-pre-tool-use.sh"))).toBe(true);
    expect(existsSync(result.hooksJsonPath)).toBe(true);

    const cfg = JSON.parse(readFileSync(result.hooksJsonPath, "utf8"));
    expect(cfg.hooks.SessionStart).toBeDefined();
    expect(cfg.hooks.UserPromptSubmit).toBeDefined();
    expect(cfg.hooks.SessionStart[0].hooks[0].command).toContain("gxpm-session-start.sh");
  });

  test("repo scope: writes to <target>/.codex/", () => {
    const fakeRepo = mkdtempSync(join(tmpdir(), "gxpm-codex-hooks-repo-"));

    const result = installCodexHooks({ scope: "repo", target: fakeRepo, gxpmRoot: repoRoot });

    expect(result.rootDir).toBe(join(fakeRepo, ".codex"));
    expect(existsSync(join(fakeRepo, ".codex", "hooks", "gxpm-session-start.sh"))).toBe(true);
    expect(existsSync(join(fakeRepo, ".codex", "hooks.json"))).toBe(true);
  });

  test("registers PreToolUse hook for update_plan recording", () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "gxpm-codex-pretool-config-"));
    installCodexHooks({ scope: "user", home: fakeHome, gxpmRoot: repoRoot });

    const cfg = JSON.parse(readFileSync(join(fakeHome, ".codex", "hooks.json"), "utf8"));
    expect(cfg.hooks.PreToolUse).toBeDefined();
    expect(cfg.hooks.PreToolUse[0].hooks[0].command).toContain("gxpm-pre-tool-use.sh");
  });

  test("scripts are executable", () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "gxpm-codex-hooks-perm-"));
    installCodexHooks({ scope: "user", home: fakeHome, gxpmRoot: repoRoot });

    const scriptPath = join(fakeHome, ".codex", "hooks", "gxpm-session-start.sh");
    const mode = statSync(scriptPath).mode;
    expect(mode & 0o111).toBeGreaterThan(0);
  });

  test("re-run is idempotent (does not duplicate entries)", () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "gxpm-codex-hooks-idem-"));

    installCodexHooks({ scope: "user", home: fakeHome, gxpmRoot: repoRoot });
    installCodexHooks({ scope: "user", home: fakeHome, gxpmRoot: repoRoot });
    installCodexHooks({ scope: "user", home: fakeHome, gxpmRoot: repoRoot });

    const cfg = JSON.parse(
      readFileSync(join(fakeHome, ".codex", "hooks.json"), "utf8"),
    );
    expect(cfg.hooks.SessionStart.length).toBe(1);
    expect(cfg.hooks.SessionStart[0].hooks.length).toBe(1);
    expect(cfg.hooks.UserPromptSubmit.length).toBe(1);
    expect(cfg.hooks.UserPromptSubmit[0].hooks.length).toBe(1);
  });

  test("auto-enables codex_hooks feature flag in ~/.codex/config.toml when missing", () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "gxpm-codex-flag-add-"));
    const codexDir = join(fakeHome, ".codex");
    execSync(`mkdir -p "${codexDir}"`);
    writeFileSync(
      join(codexDir, "config.toml"),
      "model = \"gpt-5.5\"\n\n[features]\nfast_mode = true\n",
    );

    const result = installCodexHooks({ scope: "user", home: fakeHome, gxpmRoot: repoRoot });
    expect(result.featureFlagEnabled).toBe("enabled-now");

    const cfg = readFileSync(join(codexDir, "config.toml"), "utf8");
    expect(cfg).toMatch(/codex_hooks\s*=\s*true/);
    expect(cfg).toMatch(/fast_mode\s*=\s*true/); // existing flag preserved
  });

  test("does not re-enable codex_hooks if already true (idempotent)", () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "gxpm-codex-flag-already-"));
    const codexDir = join(fakeHome, ".codex");
    execSync(`mkdir -p "${codexDir}"`);
    writeFileSync(
      join(codexDir, "config.toml"),
      "[features]\ncodex_hooks = true\n",
    );

    const result = installCodexHooks({ scope: "user", home: fakeHome, gxpmRoot: repoRoot });
    expect(result.featureFlagEnabled).toBe("already-set");
  });

  test("--no-feature-flag option skips feature flag mutation", () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "gxpm-codex-flag-skip-"));
    const codexDir = join(fakeHome, ".codex");
    execSync(`mkdir -p "${codexDir}"`);
    writeFileSync(join(codexDir, "config.toml"), "model = \"x\"\n");

    const result = installCodexHooks({
      scope: "user", home: fakeHome, gxpmRoot: repoRoot, enableFeatureFlag: false,
    });
    expect(result.featureFlagEnabled).toBe("skipped");

    const cfg = readFileSync(join(codexDir, "config.toml"), "utf8");
    expect(cfg).not.toMatch(/codex_hooks/);
  });

  test("preserves unrelated user hooks in existing hooks.json", () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "gxpm-codex-hooks-merge-"));
    const codexDir = join(fakeHome, ".codex");
    execSync(`mkdir -p "${codexDir}"`);
    writeFileSync(
      join(codexDir, "hooks.json"),
      JSON.stringify({
        hooks: {
          SessionStart: [
            {
              hooks: [{ type: "command", command: "/usr/local/bin/my-other-hook", timeout: 5 }],
            },
          ],
          Stop: [
            { hooks: [{ type: "command", command: "/usr/local/bin/notify-slack", timeout: 5 }] },
          ],
        },
      }),
    );

    installCodexHooks({ scope: "user", home: fakeHome, gxpmRoot: repoRoot });

    const cfg = JSON.parse(readFileSync(join(codexDir, "hooks.json"), "utf8"));
    // Other Stop hooks preserved
    expect(cfg.hooks.Stop[0].hooks[0].command).toContain("notify-slack");
    // User's own SessionStart preserved alongside ours
    const allCommands = cfg.hooks.SessionStart.flatMap((e: any) =>
      e.hooks.map((h: any) => h.command),
    );
    expect(allCommands).toContain("/usr/local/bin/my-other-hook");
    expect(allCommands.some((c: string) => c.includes("gxpm-session-start.sh"))).toBe(true);
  });
});

describe("hook script behavior", () => {
  test("session-start.sh emits no output when cwd has no .gxpm/issues", async () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "gxpm-codex-ss-empty-"));
    installCodexHooks({ scope: "user", home: fakeHome, gxpmRoot: repoRoot });
    const script = join(fakeHome, ".codex", "hooks", "gxpm-session-start.sh");

    const emptyCwd = mkdtempSync(join(tmpdir(), "gxpm-codex-ss-emptycwd-"));
    const result = Bun.spawnSync({
      cmd: ["bash", script],
      stdin: new TextEncoder().encode(
        JSON.stringify({ session_id: "x", cwd: emptyCwd, hook_event_name: "SessionStart" }),
      ),
      env: { ...process.env, GXPM_UPDATE_CHECK_BIN: "/does/not/exist" },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString().trim()).toBe("");
  });

  test("session-start.sh emits short static capability hint without active issue ids", async () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "gxpm-codex-ss-issues-"));
    installCodexHooks({ scope: "user", home: fakeHome, gxpmRoot: repoRoot });
    const script = join(fakeHome, ".codex", "hooks", "gxpm-session-start.sh");

    const repoCwd = mkdtempSync(join(tmpdir(), "gxpm-codex-ss-repocwd-"));
    createGxpmRepo(repoCwd, { schema: 7 });
    for (let i = 1; i <= 5; i += 1) {
      const issueDir = join(repoCwd, ".gxpm", "issues", `GXPM-${i}`);
      mkdirSync(issueDir, { recursive: true });
      writeFileSync(
        join(issueDir, "state.json"),
        JSON.stringify({ schemaVersion: 1, issueId: `GXPM-${i}`, currentPhase: "triage" }),
      );
    }

    const result = runSessionStart(script, repoCwd);
    expect(result.exitCode).toBe(0);
    const out = result.stdout.toString();
    const parsed = JSON.parse(out);
    const context = parsed.hookSpecificOutput.additionalContext;
    expect(parsed.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(context.length).toBeLessThanOrEqual(200);
    expect(context).toContain("This repo uses gxpm (schema v7, version dev).");
    expect(context).toContain("gxpm issue list");
    expect(context).toContain("gxpm issue status <id>");
    expect(context).not.toMatch(/\bGXPM-\d+\b/);
  });

  test("session-start.sh honors GXPM_SESSION_START_DISABLE kill switch", async () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "gxpm-codex-ss-disable-"));
    installCodexHooks({ scope: "user", home: fakeHome, gxpmRoot: repoRoot });
    const script = join(fakeHome, ".codex", "hooks", "gxpm-session-start.sh");
    const repoCwd = mkdtempSync(join(tmpdir(), "gxpm-codex-ss-disabledcwd-"));
    createGxpmRepo(repoCwd);

    const result = runSessionStart(script, repoCwd, { GXPM_SESSION_START_DISABLE: "1" });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString().trim()).toBe("");
  });

  test("session-start.sh substitutes schema and VERSION values", async () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "gxpm-codex-ss-vars-"));
    installCodexHooks({ scope: "user", home: fakeHome, gxpmRoot: repoRoot });
    const script = join(fakeHome, ".codex", "hooks", "gxpm-session-start.sh");
    const repoCwd = mkdtempSync(join(tmpdir(), "gxpm-codex-ss-varscwd-"));
    createGxpmRepo(repoCwd, { schema: 42, version: "0.3.0" });

    const result = runSessionStart(script, repoCwd);
    expect(result.exitCode).toBe(0);
    expect(readAdditionalContext(result.stdout.toString())).toContain(
      "schema v42, version 0.3.0",
    );
  });

  test("session-start.sh appends update context when upgrade is available", () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "gxpm-codex-ss-update-"));
    installCodexHooks({ scope: "user", home: fakeHome, gxpmRoot: repoRoot });
    const script = join(fakeHome, ".codex", "hooks", "gxpm-session-start.sh");
    const updateCheck = join(fakeHome, "gxpm-update-check");
    writeFileSync(updateCheck, "#!/bin/bash\necho 'UPGRADE_AVAILABLE 0.1.0.0 0.1.0.1'\n");
    chmodSync(updateCheck, 0o755);

    const emptyCwd = mkdtempSync(join(tmpdir(), "gxpm-codex-ss-update-cwd-"));
    const result = Bun.spawnSync({
      cmd: ["bash", script],
      stdin: new TextEncoder().encode(
        JSON.stringify({ session_id: "x", cwd: emptyCwd, hook_event_name: "SessionStart" }),
      ),
      env: { ...process.env, GXPM_UPDATE_CHECK_BIN: updateCheck },
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout.toString());
    expect(parsed.hookSpecificOutput.additionalContext).toContain("gxpm update available: 0.1.0.0 -> 0.1.0.1.");
  });

  test("session-start.sh includes Qoder wiki preflight when repowiki exists", async () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "gxpm-codex-ss-wiki-"));
    installCodexHooks({ scope: "user", home: fakeHome, gxpmRoot: repoRoot });
    const script = join(fakeHome, ".codex", "hooks", "gxpm-session-start.sh");

    const repoCwd = mkdtempSync(join(tmpdir(), "gxpm-codex-ss-wikicwd-"));
    const gxpmBin = join(repoRoot, "bin", "gxpm");
    Bun.spawnSync({ cmd: [gxpmBin, "issue", "create", "GXPM-88"], cwd: repoCwd });
    const wikiPage = join(repoCwd, ".qoder", "repowiki", "en", "content", "Overview.md");
    execSync(`mkdir -p "${dirname(wikiPage)}"`);
    writeFileSync(wikiPage, "# Overview\n\n[state](file://core/state.ts)\n");

    const result = Bun.spawnSync({
      cmd: ["bash", script],
      stdin: new TextEncoder().encode(
        JSON.stringify({ session_id: "x", cwd: repoCwd, hook_event_name: "SessionStart" }),
      ),
      env: { ...process.env, PATH: `${join(repoRoot, "bin")}:${process.env.PATH ?? ""}` },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout.toString());
    const context = parsed.hookSpecificOutput.additionalContext;
    expect(context).toContain("Qoder repo wiki detected");
    expect(context).toContain("gxpm wiki status");
    expect(context).toContain(".qoder/repowiki/en/content/Overview.md");
  });

  test("pre-tool-use.sh records update_plan arguments to the active issue", () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "gxpm-codex-pretool-run-"));
    installCodexHooks({ scope: "user", home: fakeHome, gxpmRoot: repoRoot });
    const script = join(fakeHome, ".codex", "hooks", "gxpm-pre-tool-use.sh");

    const repoCwd = mkdtempSync(join(tmpdir(), "gxpm-codex-pretool-repo-"));
    createGxpmRepo(repoCwd);
    mkdirSync(join(repoCwd, ".gxpm", "issues", "GXPM-17"), { recursive: true });
    writeFileSync(
      join(repoCwd, ".gxpm", "issues", "GXPM-17", "state.json"),
      JSON.stringify({ schemaVersion: 1, issueId: "GXPM-17", currentPhase: "dispatch", updatedAt: new Date().toISOString() }),
    );

    const gxpmStub = join(fakeHome, "gxpm");
    writeFileSync(
      gxpmStub,
      `#!/bin/bash\nif [ "$1" = "issue" ] && [ "$2" = "list" ]; then\n  echo '[{"issueId":"GXPM-17","currentPhase":"dispatch","updatedAt":"2026-04-27T00:00:00Z"}]'\nelse\n  exit 1\nfi\n`,
    );
    chmodSync(gxpmStub, 0o755);

    const result = Bun.spawnSync({
      cmd: ["bash", script],
      cwd: repoCwd,
      stdin: new TextEncoder().encode(JSON.stringify({
        cwd: repoCwd,
        hook_event_name: "PreToolUse",
        tool_name: "update_plan",
        arguments: { steps: [{ description: "read file" }] },
      })),
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, PATH: `${fakeHome}:${process.env.PATH ?? ""}` },
    });

    expect(result.exitCode).toBe(0);
    const logPath = join(repoCwd, ".gxpm", "issues", "GXPM-17", "codex-plans.jsonl");
    const lines = readFileSync(logPath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).arguments.steps[0].description).toBe("read file");
  });

  test("user-prompt-submit.sh ignores prompts without issue refs", () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "gxpm-codex-ups-noref-"));
    installCodexHooks({ scope: "user", home: fakeHome, gxpmRoot: repoRoot });
    const script = join(fakeHome, ".codex", "hooks", "gxpm-user-prompt-submit.sh");

    const result = Bun.spawnSync({
      cmd: ["bash", script],
      stdin: new TextEncoder().encode(
        JSON.stringify({ cwd: "/tmp", prompt: "hello world, nothing to see" }),
      ),
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString().trim()).toBe("");
  });

  test("user-prompt-submit.sh injects status for referenced issue ids", () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "gxpm-codex-ups-ref-"));
    installCodexHooks({ scope: "user", home: fakeHome, gxpmRoot: repoRoot });
    const script = join(fakeHome, ".codex", "hooks", "gxpm-user-prompt-submit.sh");
    const repoCwd = mkdtempSync(join(tmpdir(), "gxpm-codex-ups-repocwd-"));
    const gxpmBin = join(repoRoot, "bin", "gxpm");

    const created = Bun.spawnSync({ cmd: [gxpmBin, "issue", "create", "GXPM-1"], cwd: repoCwd });
    expect(created.exitCode).toBe(0);

    const result = Bun.spawnSync({
      cmd: ["bash", script],
      stdin: new TextEncoder().encode(
        JSON.stringify({ cwd: repoCwd, prompt: "继续 GXPM-1" }),
      ),
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, PATH: `${join(repoRoot, "bin")}:${process.env.PATH ?? ""}` },
    });
    const out = result.stdout.toString();

    expect(result.exitCode).toBe(0);
    expect(out).toContain("gxpm context for GXPM-1");
    expect(out).toContain("currentPhase: triage");
    expect(out).toContain("Next: gxpm triage init GXPM-1");
  });

  test("user-prompt-submit.sh warns a prior owner after ownership transfer", () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "gxpm-codex-ups-transfer-"));
    installCodexHooks({ scope: "user", home: fakeHome, gxpmRoot: repoRoot });
    const script = join(fakeHome, ".codex", "hooks", "gxpm-user-prompt-submit.sh");
    const repoCwd = mkdtempSync(join(tmpdir(), "gxpm-codex-ups-transfer-cwd-"));
    const gxpmBin = join(repoRoot, "bin", "gxpm");
    const envPath = { ...process.env, PATH: `${join(repoRoot, "bin")}:${process.env.PATH ?? ""}` };

    expect(Bun.spawnSync({
      cmd: [gxpmBin, "issue", "create", "GXPM-2"],
      cwd: repoCwd,
      env: { ...envPath, CODEX_COMPANION_SESSION_ID: "owner-a" },
    }).exitCode).toBe(0);
    expect(Bun.spawnSync({
      cmd: [gxpmBin, "artifact", "write", "GXPM-2", "triage-report", "--json", "{}"],
      cwd: repoCwd,
      env: { ...envPath, CODEX_COMPANION_SESSION_ID: "owner-b" },
    }).exitCode).toBe(0);

    const result = Bun.spawnSync({
      cmd: ["bash", script],
      stdin: new TextEncoder().encode(
        JSON.stringify({ cwd: repoCwd, prompt: "继续 GXPM-2" }),
      ),
      stdout: "pipe",
      stderr: "pipe",
      env: { ...envPath, CODEX_COMPANION_SESSION_ID: "owner-a" },
    });
    const out = result.stdout.toString();

    expect(result.exitCode).toBe(0);
    expect(out).toContain("ownership transferred");
    expect(out).toContain("codex:owner-b");
  });

  test("user-prompt-submit.sh stays silent about ownership for untouched sessions", () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "gxpm-codex-ups-untouched-"));
    installCodexHooks({ scope: "user", home: fakeHome, gxpmRoot: repoRoot });
    const script = join(fakeHome, ".codex", "hooks", "gxpm-user-prompt-submit.sh");
    const repoCwd = mkdtempSync(join(tmpdir(), "gxpm-codex-ups-untouched-cwd-"));
    const gxpmBin = join(repoRoot, "bin", "gxpm");
    const envPath = { ...process.env, PATH: `${join(repoRoot, "bin")}:${process.env.PATH ?? ""}` };

    expect(Bun.spawnSync({
      cmd: [gxpmBin, "issue", "create", "GXPM-3"],
      cwd: repoCwd,
      env: { ...envPath, CODEX_COMPANION_SESSION_ID: "owner-a" },
    }).exitCode).toBe(0);
    expect(Bun.spawnSync({
      cmd: [gxpmBin, "artifact", "write", "GXPM-3", "triage-report", "--json", "{}"],
      cwd: repoCwd,
      env: { ...envPath, CODEX_COMPANION_SESSION_ID: "owner-b" },
    }).exitCode).toBe(0);

    const result = Bun.spawnSync({
      cmd: ["bash", script],
      stdin: new TextEncoder().encode(
        JSON.stringify({ cwd: repoCwd, prompt: "继续 GXPM-3" }),
      ),
      stdout: "pipe",
      stderr: "pipe",
      env: { ...envPath, CODEX_COMPANION_SESSION_ID: "owner-c" },
    });
    const out = result.stdout.toString();

    expect(result.exitCode).toBe(0);
    expect(out).not.toContain("ownership transferred");
  });
});
