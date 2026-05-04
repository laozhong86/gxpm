import { createHash } from "node:crypto";
import { getResolvedConfigValue } from "./config";

/**
 * Calculate a deterministic port offset from a path string.
 * Uses MD5 hash to produce an offset in range 100-999.
 * Same path always yields same offset.
 */
export function calculatePortOffset(path: string): number {
  const hash = createHash("md5").update(path).digest();
  return (hash.readUInt16BE(0) % 900) + 100;
}

export interface ResolveDevPortInput {
  /** Workspace path used as hash seed. */
  workspacePath: string;
  /** Optional explicit base port (defaults to config or 3090). */
  basePort?: number;
  /** Optional root for config resolution. */
  root?: string;
}

/**
 * Resolve the dev server port for a workspace.
 *
 * Precedence:
 * 1. GXPM_DEV_PORT env var (validated; exits on invalid)
 * 2. PORT env var (validated; exits on invalid)
 * 3. basePort + calculatePortOffset(workspacePath)
 *
 * @returns The resolved port number
 */
export function resolveDevPort(input: ResolveDevPortInput): number {
  const envPort = process.env.GXPM_DEV_PORT ?? process.env.PORT;

  if (envPort) {
    const parsed = Number(envPort);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
      throw new Error(`Invalid port env var: ${envPort} (must be 1-65535)`);
    }
    return parsed;
  }

  const basePort =
    input.basePort ??
    Number(getResolvedConfigValue({ root: input.root, key: "workspace.basePort" }).value);

  const offset = calculatePortOffset(input.workspacePath);
  return basePort + offset;
}
