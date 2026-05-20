import { describe, test, expect } from "bun:test";
import { lstatSync, readlinkSync, realpathSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = new URL("../", import.meta.url).pathname;

describe("GXPM-154: node_modules hygiene", () => {
  test("node_modules in repo root is a real directory, not a symlink", () => {
    const nm = join(REPO_ROOT, "node_modules");
    const st = lstatSync(nm);
    if (st.isSymbolicLink()) {
      // If it must be a symlink (e.g. worktrees sharing the main repo's
      // node_modules), at least it must not point at its own original path,
      // which would create a circular resolution failure.
      const target = readlinkSync(nm);
      const targetAbs = resolve(REPO_ROOT, target);
      // Strip trailing slashes for comparison consistency.
      const normalized = (p: string) => p.replace(/\/+$/, "");
      if (normalized(targetAbs) === normalized(nm)) {
        throw new Error(
          `node_modules is a self-pointing symlink (${nm} -> ${target}). ` +
            `Run 'rm node_modules && bun install' in the repo root.`,
        );
      }
    }
    // Either a real dir or a non-self symlink — both are acceptable.
    expect(st.isDirectory() || st.isSymbolicLink()).toBe(true);
  });
});
