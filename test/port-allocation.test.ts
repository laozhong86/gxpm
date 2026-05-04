import { describe, it, expect, afterEach } from "bun:test";
import { calculatePortOffset, resolveDevPort } from "../core/port-allocation";

describe("calculatePortOffset", () => {
  it("should return a deterministic offset for the same path", () => {
    const path = "/Users/test/gxpm-worktrees/gxpm-71-feature";
    const offset1 = calculatePortOffset(path);
    const offset2 = calculatePortOffset(path);
    expect(offset2).toBe(offset1);
  });

  it("should return offset in range 100-999", () => {
    const paths = [
      "/short",
      "/a/b/c/d/e/f/g/h/i/j",
      "",
      "/Users/x/Desktop/Project/gxpm/.gxpm/local/workspaces/GXPM-71",
    ];
    for (const p of paths) {
      const offset = calculatePortOffset(p);
      expect(offset).toBeGreaterThanOrEqual(100);
      expect(offset).toBeLessThanOrEqual(999);
    }
  });

  it("should produce different offsets for different paths (high probability)", () => {
    const path1 = "/Users/test/gxpm-worktrees/gxpm-71-feature";
    const path2 = "/Users/test/gxpm-worktrees/gxpm-72-feature";
    const offset1 = calculatePortOffset(path1);
    const offset2 = calculatePortOffset(path2);
    expect(offset1).not.toBe(offset2);
  });
});

describe("resolveDevPort", () => {
  const originalEnv = { GXPM_DEV_PORT: process.env.GXPM_DEV_PORT, PORT: process.env.PORT };

  afterEach(() => {
    if (originalEnv.GXPM_DEV_PORT === undefined) {
      delete process.env.GXPM_DEV_PORT;
    } else {
      process.env.GXPM_DEV_PORT = originalEnv.GXPM_DEV_PORT;
    }
    if (originalEnv.PORT === undefined) {
      delete process.env.PORT;
    } else {
      process.env.PORT = originalEnv.PORT;
    }
  });

  it("should use GXPM_DEV_PORT when set to a valid number", () => {
    process.env.GXPM_DEV_PORT = "4000";
    const port = resolveDevPort({ workspacePath: "/any" });
    expect(port).toBe(4000);
  });

  it("should fall back to PORT when GXPM_DEV_PORT is not set", () => {
    delete process.env.GXPM_DEV_PORT;
    process.env.PORT = "5000";
    const port = resolveDevPort({ workspacePath: "/any" });
    expect(port).toBe(5000);
  });

  it("should GXPM_DEV_PORT take precedence over PORT", () => {
    process.env.GXPM_DEV_PORT = "4000";
    process.env.PORT = "5000";
    const port = resolveDevPort({ workspacePath: "/any" });
    expect(port).toBe(4000);
  });

  it("should throw on invalid port env var", () => {
    process.env.GXPM_DEV_PORT = "abc";
    expect(() => resolveDevPort({ workspacePath: "/any" })).toThrow("Invalid port env var");
  });

  it("should throw on out-of-range port env var", () => {
    process.env.GXPM_DEV_PORT = "70000";
    expect(() => resolveDevPort({ workspacePath: "/any" })).toThrow("Invalid port env var");
  });

  it("should allocate deterministic port from workspacePath when no env var is set", () => {
    delete process.env.GXPM_DEV_PORT;
    delete process.env.PORT;
    const workspacePath = "/Users/test/gxpm-worktrees/gxpm-71-feature";
    const port1 = resolveDevPort({ workspacePath });
    const port2 = resolveDevPort({ workspacePath });
    expect(port1).toBe(port2);
    expect(port1).toBeGreaterThanOrEqual(3090 + 100);
    expect(port1).toBeLessThanOrEqual(3090 + 999);
  });

  it("should respect explicit basePort", () => {
    delete process.env.GXPM_DEV_PORT;
    delete process.env.PORT;
    const workspacePath = "/Users/test/gxpm-worktrees/gxpm-71-feature";
    const port = resolveDevPort({ workspacePath, basePort: 8080 });
    expect(port).toBeGreaterThanOrEqual(8080 + 100);
    expect(port).toBeLessThanOrEqual(8080 + 999);
  });
});
