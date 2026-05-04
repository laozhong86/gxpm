import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getConfigValue,
  getResolvedConfigValue,
  listConfigEntries,
  listConfig,
  parseAgentsMdConfig,
  resolveWorktreePolicy,
  setConfigValue,
} from "../core/config";

const gxpmBin = join(import.meta.dir, "..", "bin", "gxpm");

describe("setConfigValue + getConfigValue", () => {
  test("repo scope round-trips", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-cfg-repo-"));
    setConfigValue({ root, scope: "repo", key: "worktree.enforcement", value: "required" });
    const got = getConfigValue({ root, key: "worktree.enforcement" });
    expect(got.value).toBe("required");
    expect(got.source).toBe("config-repo");
  });

  test("global scope round-trips", () => {
    const home = mkdtempSync(join(tmpdir(), "gxpm-cfg-global-home-"));
    const root = mkdtempSync(join(tmpdir(), "gxpm-cfg-global-root-"));
    setConfigValue({ home, scope: "global", key: "worktree.default", value: "use" });
    const got = getConfigValue({ home, root, key: "worktree.default" });
    expect(got.value).toBe("use");
    expect(got.source).toBe("config-global");
  });

  test("repo overrides global", () => {
    const home = mkdtempSync(join(tmpdir(), "gxpm-cfg-prec-home-"));
    const root = mkdtempSync(join(tmpdir(), "gxpm-cfg-prec-root-"));
    setConfigValue({ home, scope: "global", key: "worktree.enforcement", value: "optional" });
    setConfigValue({ root, scope: "repo", key: "worktree.enforcement", value: "required" });

    const got = getConfigValue({ home, root, key: "worktree.enforcement" });
    expect(got.value).toBe("required");
    expect(got.source).toBe("config-repo");
  });

  test("listConfig returns both repo and global docs", () => {
    const home = mkdtempSync(join(tmpdir(), "gxpm-cfg-list-home-"));
    const root = mkdtempSync(join(tmpdir(), "gxpm-cfg-list-root-"));
    setConfigValue({ home, scope: "global", key: "worktree.default", value: "skip" });
    setConfigValue({ root, scope: "repo", key: "worktree.enforcement", value: "forbidden" });

    const list = listConfig({ home, root });
    expect((list.global as any).worktree.default).toBe("skip");
    expect((list.repo as any).worktree.enforcement).toBe("forbidden");
  });

  test("worktree.baseBranch round-trips and resolves to default", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-cfg-base-branch-"));
    setConfigValue({ root, scope: "repo", key: "worktree.baseBranch", value: "develop" });
    const got = getConfigValue({ root, key: "worktree.baseBranch" });
    expect(got.value).toBe("develop");
    expect(got.source).toBe("config-repo");

    const resolved = getResolvedConfigValue({ root, key: "worktree.baseBranch" });
    expect(resolved.value).toBe("develop");
    expect(resolved.source).toBe("config-repo");

    // Default when unset
    const emptyRoot = mkdtempSync(join(tmpdir(), "gxpm-cfg-empty-"));
    const defaulted = getResolvedConfigValue({ root: emptyRoot, key: "worktree.baseBranch" });
    expect(defaulted.value).toBe("main");
    expect(defaulted.source).toBe("default");
  });

  test("resolved values include whitelisted defaults", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-cfg-default-root-"));
    const got = getResolvedConfigValue({ root, key: "update_check" });

    expect(got.value).toBe(true);
    expect(got.source).toBe("default");
  });

  test("rejects unknown keys", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-cfg-unknown-root-"));
    expect(() => setConfigValue({ root, scope: "repo", key: "random.key", value: true })).toThrow(
      "Unknown config key",
    );
  });

  test("listConfigEntries lists all known keys with current values", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-cfg-entries-root-"));
    setConfigValue({ root, scope: "repo", key: "update_check", value: false });

    const entries = listConfigEntries({ root });
    expect(entries.map((entry) => entry.key)).toEqual([
      "worktree.enforcement",
      "worktree.default",
      "worktree.baseBranch",
      "workspace.root",
      "workspace.basePort",
      "update_check",
      "sync.provider",
      "sync.linearTeamId",
      "sync.linearTeamKey",
      "sync.autoSync",
      "sync.syncArtifacts",
      "sync.linearAssigneeId",
      "agent.name",
    ]);
    expect(entries.find((entry) => entry.key === "update_check")).toMatchObject({
      value: false,
      source: "config-repo",
    });
  });

  test("gxpm config list prints all whitelisted keys", () => {
    const home = mkdtempSync(join(tmpdir(), "gxpm-cfg-cli-list-home-"));
    const root = mkdtempSync(join(tmpdir(), "gxpm-cfg-cli-list-root-"));
    const set = Bun.spawnSync({
      cmd: [gxpmBin, "config", "set", "update_check", "false"],
      cwd: root,
      env: { ...process.env, HOME: home },
      stdout: "pipe",
      stderr: "pipe",
    });
    const list = Bun.spawnSync({
      cmd: [gxpmBin, "config", "list"],
      cwd: root,
      env: { ...process.env, HOME: home },
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(set.exitCode).toBe(0);
    expect(list.exitCode).toBe(0);
    expect(list.stdout.toString()).toContain("worktree.enforcement");
    expect(list.stdout.toString()).toContain("worktree.default");
    expect(list.stdout.toString()).toContain("worktree.baseBranch");
    expect(list.stdout.toString()).toContain("workspace.root");
    expect(list.stdout.toString()).toContain("update_check: false");
  });
});

describe("parseAgentsMdConfig", () => {
  test("parses the gxpm Config section", () => {
    const md = `# Repo

## Always
- foo

## gxpm Config

- worktree.enforcement: required
- worktree.default: use

## Other Section
content
`;
    const cfg = parseAgentsMdConfig(md);
    expect((cfg as any).worktree.enforcement).toBe("required");
    expect((cfg as any).worktree.default).toBe("use");
    expect((cfg as any).worktree.baseBranch).toBeUndefined();
  });

  test("handles colon-separated lines without bullet", () => {
    const md = `## gxpm Config
worktree.enforcement: optional
`;
    const cfg = parseAgentsMdConfig(md);
    expect((cfg as any).worktree.enforcement).toBe("optional");
  });

  test("returns empty when no section present", () => {
    expect(parseAgentsMdConfig("# Just a doc\nNo gxpm config here")).toEqual({});
  });

  test("ignores unknown keys", () => {
    const cfg = parseAgentsMdConfig("## gxpm Config\n- random.key: true\n- update_check: false");
    expect((cfg as any).random).toBeUndefined();
    expect((cfg as any).update_check).toBe(false);
  });

  test("parses workspace root when present", () => {
    const cfg = parseAgentsMdConfig("## gxpm Config\n- workspace.root: .gxpm/local/workspaces");
    expect((cfg as any).workspace.root).toBe(".gxpm/local/workspaces");
  });
});

describe("resolveWorktreePolicy precedence chain", () => {
  test("level 1: config.json wins over everything", () => {
    const home = mkdtempSync(join(tmpdir(), "gxpm-policy-cfg-home-"));
    const root = mkdtempSync(join(tmpdir(), "gxpm-policy-cfg-root-"));
    setConfigValue({ root, scope: "repo", key: "worktree.enforcement", value: "required" });

    const policy = resolveWorktreePolicy({
      home,
      root,
      userMessage: { enforcement: "forbidden" },
      agentsMdContent: "## gxpm Config\n- worktree.enforcement: optional",
    });
    expect(policy.enforcement).toBe("required");
    expect(policy.source).toBe("config-repo");
  });

  test("level 2: user message wins over AGENTS.md when no config", () => {
    const home = mkdtempSync(join(tmpdir(), "gxpm-policy-um-home-"));
    const root = mkdtempSync(join(tmpdir(), "gxpm-policy-um-root-"));

    const policy = resolveWorktreePolicy({
      home,
      root,
      userMessage: { enforcement: "forbidden" },
      agentsMdContent: "## gxpm Config\n- worktree.enforcement: required",
    });
    expect(policy.enforcement).toBe("forbidden");
    expect(policy.source).toBe("user-message");
  });

  test("level 3: AGENTS.md when no config and no user message", () => {
    const home = mkdtempSync(join(tmpdir(), "gxpm-policy-md-home-"));
    const root = mkdtempSync(join(tmpdir(), "gxpm-policy-md-root-"));

    const policy = resolveWorktreePolicy({
      home,
      root,
      agentsMdContent: "## gxpm Config\n- worktree.enforcement: required\n- worktree.default: use",
    });
    expect(policy.enforcement).toBe("required");
    expect(policy.default).toBe("use");
    expect(policy.source).toBe("agents-md");
  });

  test("level 4: default when nothing else is set", () => {
    const home = mkdtempSync(join(tmpdir(), "gxpm-policy-dflt-home-"));
    const root = mkdtempSync(join(tmpdir(), "gxpm-policy-dflt-root-"));

    const policy = resolveWorktreePolicy({ home, root });
    expect(policy.enforcement).toBe("optional");
    expect(policy.default).toBe("ask");
    expect(policy.source).toBe("default");
  });

  test("config global wins over AGENTS.md but loses to repo config", () => {
    const home = mkdtempSync(join(tmpdir(), "gxpm-policy-glob-home-"));
    const root = mkdtempSync(join(tmpdir(), "gxpm-policy-glob-root-"));
    setConfigValue({ home, scope: "global", key: "worktree.enforcement", value: "optional" });

    const policy1 = resolveWorktreePolicy({
      home,
      root,
      agentsMdContent: "## gxpm Config\n- worktree.enforcement: required",
    });
    expect(policy1.source).toBe("config-global");
    expect(policy1.enforcement).toBe("optional");

    setConfigValue({ root, scope: "repo", key: "worktree.enforcement", value: "forbidden" });
    const policy2 = resolveWorktreePolicy({ home, root });
    expect(policy2.source).toBe("config-repo");
    expect(policy2.enforcement).toBe("forbidden");
  });
});
