/**
 * Safe Path — shared path escape guard.
 *
 * Extracted from core/gate.ts and core/workspace-runtime.ts.
 * All file-system writes must validate target paths through these utilities.
 */

import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

/**
 * Normalize a path for comparison.
 * Resolves symlinks via realpathSync if available; falls back to resolve.
 */
export function normalizePath(path: string): string {
  const resolved = resolve(path).replace(/\/+$/, "");
  try {
    return realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

/**
 * Check whether `candidate` is inside `root` (inclusive).
 */
export function isPathInsideRoot(root: string, candidate: string): boolean {
  const normalizedRoot = normalizePath(root);
  const normalizedCandidate = normalizePath(candidate);
  const rel = relative(normalizedRoot, normalizedCandidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * Assert that `candidate` is inside `root`. Throws if not.
 */
export function assertPathInsideRoot(root: string, candidate: string): void {
  if (!isPathInsideRoot(root, candidate)) {
    throw new Error(
      `Path escapes allowed root: candidate=${resolve(candidate)} root=${normalizePath(root)}`
    );
  }
}

/**
 * Ensure a write target is inside one of the allowed roots.
 * Accepts multiple allowed roots (e.g. project root + tmp dir).
 */
export function ensureInside(
  target: string,
  allowedRoot: string | readonly string[]
): void {
  const roots = Array.isArray(allowedRoot) ? allowedRoot : [allowedRoot];
  const ok = roots.some((root) => isPathInsideRoot(root, target));
  if (!ok) {
    throw new Error(
      `Path escape blocked: target=${resolve(target)} allowedRoots=${roots.map(normalizePath).join(", ")}`
    );
  }
}
