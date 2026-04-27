import { describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runGlobalDiscover } from "../scripts/global-discover";
import { runScript } from "./helpers/workflow";

function makeRepo(remote: string): string {
  const dir = mkdtempSync(join(tmpdir(), "gxpm-discover-repo-"));
  execSync("git init -q", { cwd: dir });
  if (remote) {
    execSync(`git remote add origin ${remote}`, { cwd: dir });
  }
  return dir;
}

describe("runGlobalDiscover", () => {
  test("scans claude and codex roots and deduplicates shared cwd by git remote", () => {
    const home = mkdtempSync(join(tmpdir(), "gxpm-discover-home-"));

    // Create two separate repos with the same remote
    const repo1 = makeRepo("https://example.com/acme/demo.git");
    const repo2 = makeRepo("https://example.com/acme/demo.git");

    // Create directory structure for claude and codex
    const claudeRoot = join(home, ".claude", "projects");
    const codexRoot = join(home, ".codex", "sessions");
    mkdirSync(claudeRoot, { recursive: true });
    mkdirSync(codexRoot, { recursive: true });

    // Link repos in different places
    writeFileSync(join(claudeRoot, "repo1.json"), JSON.stringify({ cwd: repo1 }));
    writeFileSync(join(codexRoot, "repo2.json"), JSON.stringify({ cwd: repo2 }));

    const result = runGlobalDiscover({ home });

    // Should deduplicate by git remote
    expect(result.length).toBe(1);
    expect(result[0].key).toBe("remote:https://example.com/acme/demo.git");
    expect(result[0].repos).toContain(repo1);
    expect(result[0].repos).toContain(repo2);
  });

  test("keeps cwd identity when git remote cannot be resolved", () => {
    const home = mkdtempSync(join(tmpdir(), "gxpm-discover-home-"));

    // Create a repo without a remote
    const repoNoRemote = makeRepo("");

    const claudeRoot = join(home, ".claude", "projects");
    mkdirSync(claudeRoot, { recursive: true });
    writeFileSync(join(claudeRoot, "local.json"), JSON.stringify({ cwd: repoNoRemote }));

    const result = runGlobalDiscover({ home });

    // Should use cwd fallback key when no remote
    expect(result.length).toBe(1);
    expect(result[0].key).toBe(`cwd:${repoNoRemote}`);
    expect(result[0].repos).toContain(repoNoRemote);
  });

  test("reads cwd from payload.cwd in Codex JSONL entries", () => {
    const home = mkdtempSync(join(tmpdir(), "gxpm-discover-home-"));
    const repo = makeRepo("https://example.com/codex.git");

    const codexRoot = join(home, ".codex", "sessions", "2026", "04", "27");
    mkdirSync(codexRoot, { recursive: true });
    writeFileSync(
      join(codexRoot, "session.jsonl"),
      [
        JSON.stringify({ payload: { cwd: repo } }),
        JSON.stringify({ payload: { cwd: repo } }),
      ].join("\n") + "\n",
    );

    const result = runGlobalDiscover({ home });

    expect(result.length).toBe(1);
    expect(result[0].key).toBe("remote:https://example.com/codex.git");
    expect(result[0].repos).toEqual([repo]);
  });

  test("tolerates a missing codex root when claude root exists", () => {
    const home = mkdtempSync(join(tmpdir(), "gxpm-discover-home-"));

    const repo = makeRepo("https://example.com/test.git");

    // Only create claude root, not codex
    const claudeRoot = join(home, ".claude", "projects");
    mkdirSync(claudeRoot, { recursive: true });
    writeFileSync(join(claudeRoot, "test.json"), JSON.stringify({ cwd: repo }));

    // codexRoot is not created

    const result = runGlobalDiscover({ home });

    expect(result.length).toBe(1);
    expect(result[0].key).toBe("remote:https://example.com/test.git");
    expect(result[0].repos).toContain(repo);
  });

  test("CLI prints discovered entries as JSON", () => {
    const home = mkdtempSync(join(tmpdir(), "gxpm-discover-home-"));
    const repo = makeRepo("https://example.com/cli.git");

    const claudeRoot = join(home, ".claude", "projects");
    mkdirSync(claudeRoot, { recursive: true });
    writeFileSync(join(claudeRoot, "cli.json"), JSON.stringify({ cwd: repo }));

    const result = runScript(["scripts/gxpm.ts", "global-discover", "--json"], process.cwd(), {
      HOME: home,
    });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout.toString())).toEqual([
      expect.objectContaining({
        key: "remote:https://example.com/cli.git",
        repos: [repo],
      }),
    ]);
  });
});
