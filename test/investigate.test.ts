import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createIssueState } from "../core/state";

const repoRoot = resolve(import.meta.dir, "..");
const investigateBin = join(repoRoot, "bin", "gxpm-investigate");

function makeIssueRoot(issueId = "GXPM-60") {
  const root = mkdtempSync(join(tmpdir(), "gxpm-investigate-root-"));
  createIssueState({ root, issueId });
  return { root, issueId };
}

function runInvestigate(input: {
  root: string;
  issueId: string;
  env?: Record<string, string>;
  args?: string[];
}) {
  return Bun.spawnSync({
    cmd: [process.execPath, "run", investigateBin, input.issueId, ...(input.args ?? [])],
    cwd: input.root,
    env: { ...process.env, ...(input.env ?? {}) },
    stdout: "pipe",
    stderr: "pipe",
  });
}

function output(result: ReturnType<typeof runInvestigate>) {
  return `${result.stdout.toString()}${result.stderr.toString()}`;
}

function makeMockCmux(failOn = "") {
  const dir = mkdtempSync(join(tmpdir(), "gxpm-mock-cmux-"));
  const bin = join(dir, "cmux");
  const log = join(dir, "cmux.log");
  writeFileSync(
    bin,
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$CMUX_LOG"
if [ "$#" -ge 3 ] && [ "$1" = "browser" ] && [ "$2" = "surface:7" ]; then
  subcommand="$3"
  if [ "\${CMUX_FAIL_ON:-}" = "$subcommand" ]; then
    echo "mock cmux failure on $subcommand" >&2
    exit 42
  fi
  case "$subcommand" in
    get-url)
      echo "https://example.test/current"
      ;;
    eval)
      echo '{"url":"https://example.test/current","viewport":{"width":1280,"height":720},"isMobile":false}'
      ;;
    snapshot)
      echo "document"
      echo "  button Submit"
      ;;
    screenshot)
      out="$5"
      mkdir -p "$(dirname "$out")"
      printf 'fake-png' > "$out"
      echo "$out"
      ;;
    console)
      echo "info: ready"
      echo "warn: slow"
      ;;
    errors)
      echo "TypeError: sample"
      ;;
    *)
      echo "unexpected browser subcommand: $subcommand" >&2
      exit 2
      ;;
  esac
  exit 0
fi
echo "unexpected cmux args: $*" >&2
exit 2
`,
  );
  chmodSync(bin, 0o755);
  return { dir, log, env: { PATH: `${dir}:${process.env.PATH}`, CMUX_LOG: log, CMUX_FAIL_ON: failOn } };
}

function readInvestigation(root: string, issueId: string) {
  const investigationsDir = join(root, ".gxpm", "issues", issueId, "evidence", "investigations");
  const file = readdirSync(investigationsDir).find((name) => /^investigation-.+\.json$/.test(name));
  expect(file).toBeTruthy();
  const path = join(investigationsDir, file!);
  return { path, payload: JSON.parse(readFileSync(path, "utf8")) };
}

describe("gxpm-investigate", () => {
  test("prints help successfully without cmux context", () => {
    const { root } = makeIssueRoot();

    const result = runInvestigate({ root, issueId: "--help", env: { CMUX_SURFACE_ID: "" } });

    expect(result.exitCode).toBe(0);
    expect(output(result)).toContain("Usage: gxpm-investigate");
  });

  test("fails clearly when CMUX_SURFACE_ID is missing", () => {
    const { root, issueId } = makeIssueRoot();

    const result = runInvestigate({ root, issueId, env: { CMUX_SURFACE_ID: "" } });

    expect(result.exitCode).toBe(1);
    expect(output(result)).toContain("CMUX_SURFACE_ID");
  });

  test("fails clearly when cmux is unavailable", () => {
    const { root, issueId } = makeIssueRoot();
    const emptyPath = mkdtempSync(join(tmpdir(), "gxpm-no-cmux-path-"));

    const result = runInvestigate({
      root,
      issueId,
      env: { CMUX_SURFACE_ID: "surface:7", PATH: emptyPath },
    });

    expect(result.exitCode).toBe(1);
    expect(output(result)).toContain("cmux CLI was not found");
  });

  test("rejects invalid issue ids before writing artifacts", () => {
    const { root, issueId } = makeIssueRoot();
    const mock = makeMockCmux();

    const result = runInvestigate({
      root,
      issueId: `../${issueId}`,
      env: { ...mock.env, CMUX_SURFACE_ID: "surface:7" },
    });

    expect(result.exitCode).toBe(1);
    expect(output(result)).toContain("Invalid issue id");
    expect(existsSync(join(root, ".gxpm", "issues", issueId, "evidence", "investigations"))).toBe(false);
    expect(readdirSync(join(root, ".gxpm", "issues", issueId, "evidence", "screenshots"))).toEqual([]);
    expect(existsSync(join(root, ".gxpm", issueId))).toBe(false);
  });

  test("captures current cmux page evidence into the issue tree", () => {
    const { root, issueId } = makeIssueRoot();
    const mock = makeMockCmux();

    const result = runInvestigate({
      root,
      issueId,
      args: ["--label", "checkout panel"],
      env: { ...mock.env, CMUX_SURFACE_ID: "surface:7" },
    });

    expect(result.exitCode).toBe(0);
    const log = readFileSync(mock.log, "utf8").trim().split("\n");
    expect(log[0]).toBe("browser surface:7 get-url");
    expect(log[1]).toContain("browser surface:7 eval");
    expect(log[2]).toBe("browser surface:7 snapshot --compact");
    expect(log[3]).toContain("browser surface:7 screenshot --out");
    expect(log[4]).toBe("browser surface:7 console list");
    expect(log[5]).toBe("browser surface:7 errors list");
    expect(log.length).toBe(6);

    const { payload } = readInvestigation(root, issueId);
    expect(payload.surface_id).toBe("surface:7");
    expect(payload.label).toBe("checkout panel");
    expect(payload.url).toBe("https://example.test/current");
    expect(payload.viewport).toEqual({ width: 1280, height: 720 });
    expect(payload.isMobile).toBe(false);
    expect(payload.snapshot_text).toContain("button Submit");
    expect(payload.console_lines).toEqual(["info: ready", "warn: slow"]);
    expect(payload.errors).toEqual(["TypeError: sample"]);
    expect(payload.screenshot_path).toMatch(/^evidence\/screenshots\/investigation-.+\.png$/);
    expect(existsSync(join(root, ".gxpm", "issues", issueId, payload.screenshot_path))).toBe(true);
    expect(existsSync(join(root, ".gxpm", "issues", issueId, "artifacts", "investigation.json"))).toBe(false);
  });

  test("persists partial evidence when a cmux command fails", () => {
    const { root, issueId } = makeIssueRoot();
    const mock = makeMockCmux("errors");

    const result = runInvestigate({
      root,
      issueId,
      env: { ...mock.env, CMUX_SURFACE_ID: "surface:7" },
    });

    expect(result.exitCode).toBe(1);
    expect(output(result)).toContain("errors list");
    const { payload } = readInvestigation(root, issueId);
    expect(payload.status).toBe("failed");
    expect(payload.snapshot_text).toContain("button Submit");
    expect(payload.errors).toEqual([]);
    expect(payload.failure.message).toContain("mock cmux failure on errors");
  });
});
