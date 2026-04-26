import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getConfigValue,
  listConfig,
  parseAgentsMdConfig,
  resolveWorktreePolicy,
  setConfigValue,
} from "../core/config";

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
