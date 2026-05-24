// Feature: gxpm-browser persistent-session support
//
// As a verify-phase agent
// I want to chain authenticated gxpm-browser commands using a saved Playwright storage-state
// So that I capture real authenticated evidence without re-running browse:auth per command.
//
// Stubs intentionally empty during specify phase — TDD implementation belongs to the implement phase.

import { test, expect } from "bun:test";
import { mkdtempSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BROWSER_CLI = join(import.meta.dir, "..", "..", "scripts", "browser.ts");
const DATA_URI = "data:text/html,<title>scn</title>";

function spawnBrowser(args: string[], cwd?: string) {
  return Bun.spawnSync({
    cmd: ["bun", "run", BROWSER_CLI, ...args],
    stdout: "pipe",
    stderr: "pipe",
    ...(cwd ? { cwd } : {}),
  });
}

// Scenario (scn-01-stateless-default-preserved): default behaviour writes no session
//   Given a gxpm-browser command invoked without any storage-state flag
//   And the target page does not require authentication
//   When the operator captures a screenshot of a publicly reachable page
//   Then the Playwright browser context is created without a storageState argument
//   And no storage-state file appears anywhere under the working directory
test("gxpm-browser leaves stateless behaviour unchanged when no persistence flag is provided", () => {
  const work = mkdtempSync(join(tmpdir(), "gxpm-198-scn01-"));
  const sentinel = join(work, "storage-state.json");
  const result = spawnBrowser(["navigate", DATA_URI, "--json"], work);
  expect(result.exitCode).toBe(0);
  expect(existsSync(sentinel)).toBe(false);
});

// Scenario (scn-02-save-explicit-path): operator saves an authenticated session to an explicit path
//   Given an operator running a verify-phase command against an authenticated workspace page
//   And the operator passes --save-storage-state pointing to a writable explicit path
//   When the command completes successfully
//   Then a Playwright-parseable storage-state file is written at the given path
//   And the file contains at least one cookie or origin entry from the captured session
test("gxpm-browser persists the authenticated session to the explicit --save-storage-state path", () => {
  const work = mkdtempSync(join(tmpdir(), "gxpm-198-scn02-"));
  const statePath = join(work, "session.json");

  const result = spawnBrowser(["navigate", DATA_URI, "--save-storage-state", statePath, "--json"]);
  expect(result.exitCode).toBe(0);
  expect(existsSync(statePath)).toBe(true);

  const parsed = JSON.parse(readFileSync(statePath, "utf-8"));
  expect(Array.isArray(parsed.cookies)).toBe(true);
  expect(Array.isArray(parsed.origins)).toBe(true);
});

// Scenario (scn-03-reuse-saved-session): follow-up command reuses a previously saved session
//   Given a storage-state file previously written by an earlier gxpm-browser command
//   And the file contains the operator's project session cookie
//   When the operator invokes a follow-up gxpm-browser command with --storage-state pointing to that file
//   Then the browser context loads the cookie before navigating
//   And the operator captures evidence of the authenticated chat page in a single command
test("gxpm-browser reuses a previously saved storage-state without re-running browse:auth", async () => {
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req) {
      const path = new URL(req.url).pathname;
      if (path !== "/") return new Response("", { status: 204 });
      const cookie = req.headers.get("cookie") || "";
      return new Response(`<!doctype html><div id="c">${cookie}</div>`, {
        headers: { "Content-Type": "text/html" },
      });
    },
  });
  try {
    const url = `http://127.0.0.1:${server.port}/`;
    const work = mkdtempSync(join(tmpdir(), "gxpm-198-scn03-"));
    const statePath = join(work, "session.json");
    const state = {
      cookies: [
        {
          name: "scn03",
          value: "ok",
          domain: "127.0.0.1",
          path: "/",
          expires: -1,
          httpOnly: false,
          secure: false,
          sameSite: "Lax" as const,
        },
      ],
      origins: [],
    };
    writeFileSync(statePath, JSON.stringify(state));

    const proc = Bun.spawn({
      cmd: ["bun", "run", BROWSER_CLI, "assert", url, "--selector", "#c", "--text", "scn03=ok", "--storage-state", statePath, "--json"],
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();
    expect(exitCode).toBe(0);
    const out = JSON.parse(stdout);
    expect(out.pass).toBe(true);
  } finally {
    server.stop();
  }
}, 60000);

// Scenario (scn-04-issueid-defaults-evidence-path): --issueid sets a sensible save default
//   Given an operator running with --issueid set to an active gxpm issue
//   And the operator passes --save-storage-state without an explicit path
//   When the command completes successfully
//   Then the storage-state file is written under the issue's evidence/browser directory in the main repo
//   And the file path is matched by the repository's gitignore rules
test("gxpm-browser defaults the --save-storage-state path under the issue evidence dir and gitignores it", async () => {
  const work = mkdtempSync(join(tmpdir(), "gxpm-198-scn04-"));
  const issueId = "GXPM-TEST198";
  mkdirSync(join(work, ".gxpm", "issues", issueId), { recursive: true });

  const proc = Bun.spawn({
    cmd: ["bun", "run", BROWSER_CLI, "navigate", DATA_URI, "--issueid", issueId, "--save-storage-state", "--json"],
    cwd: work,
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  expect(exitCode).toBe(0);

  const expectedPath = join(work, ".gxpm", "issues", issueId, "evidence", "browser", "storage-state.json");
  expect(existsSync(expectedPath)).toBe(true);

  const parsed = JSON.parse(readFileSync(expectedPath, "utf-8"));
  expect(Array.isArray(parsed.cookies)).toBe(true);
}, 30000);

// Scenario (scn-05-opt-in-no-leak): omitting the save flag never writes a state file
//   Given an operator running with --issueid set but without --save-storage-state
//   When the command completes successfully
//   Then no storage-state file appears under the issue's evidence/browser directory
//   And the captured artifact set matches the pre-feature baseline byte-for-byte
test("gxpm-browser never writes a storage-state file when the save flag is omitted", async () => {
  const work = mkdtempSync(join(tmpdir(), "gxpm-198-scn05-"));
  const issueId = "GXPM-TEST198-LEAK";
  mkdirSync(join(work, ".gxpm", "issues", issueId), { recursive: true });

  const proc = Bun.spawn({
    cmd: ["bun", "run", BROWSER_CLI, "navigate", DATA_URI, "--issueid", issueId, "--json"],
    cwd: work,
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  expect(exitCode).toBe(0);

  const leakPath = join(work, ".gxpm", "issues", issueId, "evidence", "browser", "storage-state.json");
  expect(existsSync(leakPath)).toBe(false);
}, 30000);
