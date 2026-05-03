import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

let volatileSessionId: string | null = null;

export function resolveSessionId(env: NodeJS.ProcessEnv = process.env): string {
  const codexSessionId = env.CODEX_COMPANION_SESSION_ID?.trim();
  if (codexSessionId) {
    return `codex:${codexSessionId}`;
  }

  const cmuxSurfaceId = env.CMUX_SURFACE_ID?.trim();
  if (cmuxSurfaceId) {
    return `cmux:${cmuxSurfaceId}`;
  }

  return `gen:${readOrCreateGeneratedSessionId(env)}`;
}

export interface AgentIdentity {
  host: string;
  sessionId: string;
  actor: string;
}

export function resolveAgentIdentity(env: NodeJS.ProcessEnv = process.env): AgentIdentity {
  const sessionId = resolveSessionId(env);
  const host = sessionId.split(":")[0] ?? "gen";
  const actor = env.GXPM_AGENT_NAME?.trim() || host;
  return { host, sessionId, actor };
}

function readOrCreateGeneratedSessionId(env: NodeJS.ProcessEnv): string {
  for (const cachePath of candidateCachePaths(env)) {
    try {
      if (existsSync(cachePath)) {
        const cached = readFileSync(cachePath, "utf8").trim();
        if (cached) {
          return cached;
        }
      }

      const generated = randomUUID();
      mkdirSync(join(cachePath, ".."), { recursive: true });
      writeFileSync(cachePath, `${generated}\n`);
      return generated;
    } catch {}
  }

  volatileSessionId ??= randomUUID();
  return volatileSessionId;
}

function candidateCachePaths(env: NodeJS.ProcessEnv): string[] {
  const paths = new Set<string>();
  const home = env.HOME?.trim() || homedir();
  if (home) {
    paths.add(join(home, ".gxpm", "session-id"));
  }
  paths.add(join(tmpdir(), "gxpm", "session-id"));
  return [...paths];
}
