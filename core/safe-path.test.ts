import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { normalizePath, isPathInsideRoot, assertPathInsideRoot, ensureInside } from "./safe-path";
import { resolve, join } from "node:path";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";

let tmpDir: string;

function setupTmp() {
  tmpDir = mkdtempSync(join(tmpdir(), "safe-path-test-"));
  mkdirSync(join(tmpDir, "foo", "bar"), { recursive: true });
}

function cleanupTmp() {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
}

describe("normalizePath", () => {
  it("resolves relative paths", () => {
    expect(normalizePath(".")).toBe(resolve("."));
  });

  it("normalizes trailing slashes", () => {
    const p = normalizePath("/tmp/");
    expect(p.endsWith("/")).toBe(false);
  });
});

describe("isPathInsideRoot", () => {
  beforeEach(() => setupTmp());
  afterEach(() => cleanupTmp());

  it("returns true for paths inside root", () => {
    expect(isPathInsideRoot(tmpDir, join(tmpDir, "foo"))).toBe(true);
    expect(isPathInsideRoot(tmpDir, join(tmpDir, "foo", "bar"))).toBe(true);
  });

  it("returns true for root itself", () => {
    expect(isPathInsideRoot(tmpDir, tmpDir)).toBe(true);
  });

  it("returns false for paths outside root", () => {
    expect(isPathInsideRoot(tmpDir, "/usr")).toBe(false);
    expect(isPathInsideRoot(join(tmpDir, "foo"), join(tmpDir, "bar"))).toBe(false);
  });

  it("returns false for traversal escapes", () => {
    expect(isPathInsideRoot(tmpDir, join(tmpDir, "..", "etc"))).toBe(false);
  });
});

describe("assertPathInsideRoot", () => {
  beforeEach(() => setupTmp());
  afterEach(() => cleanupTmp());

  it("does not throw for valid paths", () => {
    expect(() => assertPathInsideRoot(tmpDir, join(tmpDir, "foo"))).not.toThrow();
  });

  it("throws for escaped paths", () => {
    expect(() => assertPathInsideRoot(tmpDir, "/usr")).toThrow("Path escapes allowed root");
  });
});

describe("ensureInside", () => {
  beforeEach(() => setupTmp());
  afterEach(() => cleanupTmp());

  it("accepts single root", () => {
    expect(() => ensureInside(join(tmpDir, "foo"), tmpDir)).not.toThrow();
  });

  it("accepts multiple roots if one matches", () => {
    expect(() => ensureInside(join(tmpDir, "foo"), ["/usr", tmpDir])).not.toThrow();
  });

  it("throws if none match", () => {
    expect(() => ensureInside("/usr", ["/tmp", "/var"])).toThrow("Path escape blocked");
  });
});
