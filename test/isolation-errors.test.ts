import { describe, expect, test } from "bun:test";
import {
  classifyIsolationError,
  isKnownIsolationError,
  getIsolationBlockReason,
  IsolationBlockedError,
} from "../core/isolation-errors";

describe("classifyIsolationError", () => {
  test("classifies permission denied", () => {
    const err = new Error("Permission denied while creating workspace");
    expect(classifyIsolationError(err)).toContain("Permission denied");
  });

  test("classifies EACCES case-insensitively", () => {
    const err = new Error("EACCES: something");
    expect(classifyIsolationError(err)).toContain("Permission denied");
  });

  test("classifies timeout", () => {
    const err = new Error("timeout creating workspace");
    expect(classifyIsolationError(err)).toContain("Timed out");
  });

  test("classifies no space left", () => {
    const err = new Error("No space left on device");
    expect(classifyIsolationError(err)).toContain("No disk space");
  });

  test("classifies ENOSPC", () => {
    const err = new Error("ENOSPC");
    expect(classifyIsolationError(err)).toContain("No disk space");
  });

  test("classifies not a git repository", () => {
    const err = new Error("not a git repository");
    expect(classifyIsolationError(err)).toContain("not a valid git repository");
  });

  test("classifies branch not found", () => {
    const err = new Error("branch not found");
    expect(classifyIsolationError(err)).toContain("Branch not found");
  });

  test("classifies belongs to a different clone", () => {
    const err = new Error("belongs to a different clone");
    expect(classifyIsolationError(err)).toContain("different local clone");
  });

  test("classifies cannot verify worktree ownership", () => {
    const err = new Error("cannot verify worktree ownership");
    expect(classifyIsolationError(err)).toContain("Cannot verify ownership");
  });

  test("classifies cannot adopt", () => {
    const err = new Error("cannot adopt existing directory");
    expect(classifyIsolationError(err)).toContain("Refused to adopt");
  });

  test("classifies submodule initialization failed", () => {
    const err = new Error("submodule initialization failed");
    expect(classifyIsolationError(err)).toContain("Submodule initialization failed");
  });

  test("classifies cannot extract owner/repo", () => {
    const err = new Error("cannot extract owner/repo");
    expect(classifyIsolationError(err)).toContain("too short to extract");
  });

  test("returns generic message for unknown errors", () => {
    const err = new Error("something weird happened");
    expect(classifyIsolationError(err)).toContain("something weird happened");
  });

  test("includes stderr in pattern matching", () => {
    const err = new Error("failed");
    (err as Error & { stderr?: string }).stderr = "permission denied";
    expect(classifyIsolationError(err)).toContain("Permission denied");
  });
});

describe("isKnownIsolationError", () => {
  test("known infrastructure errors return true", () => {
    expect(isKnownIsolationError(new Error("permission denied"))).toBe(true);
    expect(isKnownIsolationError(new Error("no space left"))).toBe(true);
    expect(isKnownIsolationError(new Error("timeout"))).toBe(true);
  });

  test("unknown programming errors return false", () => {
    expect(isKnownIsolationError(new Error("cannot extract owner/repo"))).toBe(false);
  });

  test("unmatched errors return false", () => {
    expect(isKnownIsolationError(new Error("random failure"))).toBe(false);
  });
});

describe("getIsolationBlockReason", () => {
  test("maps permission denied to permission_denied", () => {
    expect(getIsolationBlockReason(new Error("permission denied"))).toBe("permission_denied");
  });

  test("maps unknown to unknown", () => {
    expect(getIsolationBlockReason(new Error("random"))).toBe("unknown");
  });
});

describe("IsolationBlockedError", () => {
  test("carries reason", () => {
    const err = new IsolationBlockedError("blocked", "creation_failed");
    expect(err.name).toBe("IsolationBlockedError");
    expect(err.reason).toBe("creation_failed");
    expect(err.message).toBe("blocked");
  });
});
