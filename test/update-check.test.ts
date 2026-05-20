import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "..");
const gxpmBin = join(repoRoot, "bin", "gxpm");
const updateCheckBin = join(repoRoot, "bin", "gxpm-update-check");
// GXPM-173: package.json.version is the single source of truth; the legacy
// repo-root VERSION file was removed in 0.2.0.
const localVersion = (
  JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as { version: string }
).version;

function makeRemote(version: string) {
  // The remote URL now points at a package.json (see bin/gxpm-update-check
  // GXPM-173 migration); emit a minimal JSON payload so the script's
  // extract_version_from_payload picks it up. extract_version_from_payload
  // also accepts the legacy raw-string format for back-compat with custom
  // GXPM_REMOTE_URL overrides.
  const dir = mkdtempSync(join(tmpdir(), "gxpm-remote-version-"));
  const path = join(dir, "package.json");
  writeFileSync(path, JSON.stringify({ name: "@geminix/gxpm", version }, null, 2) + "\n");
  return path;
}

function runUpdateCheck(input: {
  home?: string;
  cwd?: string;
  remoteVersion?: string;
  remotePath?: string;
  args?: string[];
}) {
  const home = input.home ?? mkdtempSync(join(tmpdir(), "gxpm-update-home-"));
  const cwd = input.cwd ?? mkdtempSync(join(tmpdir(), "gxpm-update-cwd-"));
  const remote = input.remotePath ?? makeRemote(input.remoteVersion ?? localVersion);
  return Bun.spawnSync({
    cmd: [updateCheckBin, ...(input.args ?? [])],
    cwd,
    env: {
      ...process.env,
      HOME: home,
      GXPM_DIR: repoRoot,
      GXPM_STATE_DIR: join(home, ".gxpm"),
      GXPM_REMOTE_URL: `file://${remote}`,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
}

describe("gxpm-update-check", () => {
  test("emits UPGRADE_AVAILABLE for newer remote VERSION", () => {
    const result = runUpdateCheck({ remoteVersion: "9.9.9", args: ["--force"] });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString().trim()).toBe(`UPGRADE_AVAILABLE ${localVersion} 9.9.9`);
  });

  test("emits JUST_UPGRADED once from marker", () => {
    const home = mkdtempSync(join(tmpdir(), "gxpm-update-just-home-"));
    const stateDir = join(home, ".gxpm");
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(join(stateDir, "just-upgraded-from"), "0.0.9\n");

    const first = runUpdateCheck({ home, remoteVersion: localVersion });
    const second = runUpdateCheck({ home, remoteVersion: localVersion });

    expect(first.exitCode).toBe(0);
    expect(first.stdout.toString().trim()).toBe(`JUST_UPGRADED 0.0.9 ${localVersion}`);
    expect(second.exitCode).toBe(0);
    expect(second.stdout.toString().trim()).toBe("");
  });

  test("stays silent when remote matches local VERSION", () => {
    const result = runUpdateCheck({ remoteVersion: localVersion, args: ["--force"] });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString().trim()).toBe("");
  });

  test("update_check=false disables output", () => {
    const home = mkdtempSync(join(tmpdir(), "gxpm-update-disabled-home-"));
    const cwd = mkdtempSync(join(tmpdir(), "gxpm-update-disabled-cwd-"));
    const setConfig = Bun.spawnSync({
      cmd: [gxpmBin, "config", "set", "update_check", "false", "--global"],
      cwd,
      env: { ...process.env, HOME: home },
      stdout: "pipe",
      stderr: "pipe",
    });

    const result = runUpdateCheck({ home, cwd, remoteVersion: "9.9.9", args: ["--force"] });

    expect(setConfig.exitCode).toBe(0);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString().trim()).toBe("");
  });

  test("snooze suppresses same version until duration expires", () => {
    const home = mkdtempSync(join(tmpdir(), "gxpm-update-snooze-home-"));
    const stateDir = join(home, ".gxpm");
    mkdirSync(stateDir, { recursive: true });
    const now = Math.floor(Date.now() / 1000);
    writeFileSync(join(stateDir, "update-snoozed"), `9.9.9 1 ${now}\n`);

    const snoozed = runUpdateCheck({ home, remoteVersion: "9.9.9" });
    writeFileSync(join(stateDir, "update-snoozed"), `9.9.9 1 ${now - 86401}\n`);
    const expired = runUpdateCheck({ home, remoteVersion: "9.9.9" });

    expect(snoozed.exitCode).toBe(0);
    expect(snoozed.stdout.toString().trim()).toBe("");
    expect(expired.exitCode).toBe(0);
    expect(expired.stdout.toString().trim()).toBe(`UPGRADE_AVAILABLE ${localVersion} 9.9.9`);
  });

  test("new remote version ignores old snooze", () => {
    const home = mkdtempSync(join(tmpdir(), "gxpm-update-new-version-home-"));
    const stateDir = join(home, ".gxpm");
    mkdirSync(stateDir, { recursive: true });
    const now = Math.floor(Date.now() / 1000);
    writeFileSync(join(stateDir, "update-snoozed"), `9.9.9.8 3 ${now}\n`);

    const result = runUpdateCheck({ home, remoteVersion: "9.9.9" });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString().trim()).toBe(`UPGRADE_AVAILABLE ${localVersion} 9.9.9`);
    expect(readFileSync(join(stateDir, "update-snoozed"), "utf8").trim()).toBe(`9.9.9.8 3 ${now}`);
  });

  test("--force skips cache and snooze", () => {
    const home = mkdtempSync(join(tmpdir(), "gxpm-update-force-home-"));
    const stateDir = join(home, ".gxpm");
    mkdirSync(stateDir, { recursive: true });
    const now = Math.floor(Date.now() / 1000);
    writeFileSync(join(stateDir, "last-update-check"), `UP_TO_DATE ${localVersion}\n`);
    writeFileSync(join(stateDir, "update-snoozed"), `9.9.9 3 ${now}\n`);

    const result = runUpdateCheck({ home, remoteVersion: "9.9.9", args: ["--force"] });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString().trim()).toBe(`UPGRADE_AVAILABLE ${localVersion} 9.9.9`);
    expect(existsSync(join(stateDir, "update-snoozed"))).toBe(false);
  });
});
