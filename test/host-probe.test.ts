import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { probeHosts, detectedHostNames } from "../core/host-probe";

describe("host probe", () => {
  let repoDir: string;
  const originalHome = process.env.HOME;

  beforeEach(() => {
    repoDir = mkdtempSync(join(tmpdir(), "gxpm-probe-"));
    process.env.HOME = repoDir;
  });

  afterEach(() => {
    process.env.HOME = originalHome;
  });

  it("returns all registered hosts", () => {
    const results = probeHosts(repoDir);
    const names = results.map((r) => r.host);
    expect(names).toContain("claude");
    expect(names).toContain("codex");
    expect(names).toContain("cursor");
  });

  it("detects host when repo config directory exists", () => {
    mkdirSync(join(repoDir, ".claude"), { recursive: true });
    const results = probeHosts(repoDir);
    const claude = results.find((r) => r.host === "claude");
    expect(claude).toBeDefined();
    expect(claude!.repoConfigExists).toBe(true);
    expect(claude!.detected).toBe(true);
  });

  it("detects host when user config directory exists", () => {
    mkdirSync(join(repoDir, ".codex"), { recursive: true });
    const results = probeHosts(repoDir);
    const codex = results.find((r) => r.host === "codex");
    expect(codex).toBeDefined();
    expect(codex!.userConfigExists).toBe(true);
    expect(codex!.detected).toBe(true);
  });

  it("detectedHostNames includes repo-configured host", () => {
    mkdirSync(join(repoDir, ".cursor"), { recursive: true });
    const names = detectedHostNames(repoDir);
    expect(names).toContain("cursor");
  });

  it("does not double-count: repo config alone is sufficient", () => {
    mkdirSync(join(repoDir, ".claude"), { recursive: true });
    const results = probeHosts(repoDir);
    const claude = results.find((r) => r.host === "claude")!;
    expect(claude.repoConfigExists).toBe(true);
    expect(claude.detected).toBe(true);
  });
});
