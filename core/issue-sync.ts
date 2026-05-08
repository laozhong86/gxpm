import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { getIssuePaths, type GxpmPhase, type IssueState } from "./state";
import { type ArtifactRecord } from "./artifacts";
import { getConfigValue } from "./config";

export const CURRENT_SYNC_SCHEMA_VERSION = 1;

export interface SyncTarget {
  provider: "linear" | "github";
  externalId: string;
  displayId: string;
  url: string;
  syncedAt?: string;
  pendingPush?: boolean;
  lastError?: {
    message: string;
    timestamp: string;
  };
}

export interface SyncState {
  schemaVersion: number;
  issueId: string;
  targets: SyncTarget[];
}

interface SyncProvider {
  name: "linear" | "github";
  createIssue(issueId: string, issueType: string, title: string): Promise<SyncTarget>;
  updatePhase(target: SyncTarget, phase: GxpmPhase): Promise<void>;
  updateDescription(target: SyncTarget, description: string): Promise<void>;
  archiveIssue(target: SyncTarget, archived: boolean): Promise<void>;
}

export function getSyncPaths(root: string, issueId: string) {
  const paths = getIssuePaths(root, issueId);
  return {
    ...paths,
    syncPath: join(paths.issueDir, "sync.json"),
  };
}

export function readSyncState(input: { root?: string; issueId: string }): SyncState {
  const root = input.root ?? process.cwd();
  const { syncPath } = getSyncPaths(root, input.issueId);
  if (!existsSync(syncPath)) {
    return { schemaVersion: CURRENT_SYNC_SCHEMA_VERSION, issueId: input.issueId, targets: [] };
  }
  try {
    const raw = JSON.parse(readFileSync(syncPath, "utf8")) as SyncState;
    if (typeof raw.schemaVersion !== "number") {
      return { schemaVersion: CURRENT_SYNC_SCHEMA_VERSION, issueId: input.issueId, targets: [] };
    }
    return {
      schemaVersion: raw.schemaVersion,
      issueId: String(raw.issueId),
      targets: Array.isArray(raw.targets) ? raw.targets.map(normalizeSyncTarget) : [],
    };
  } catch {
    return { schemaVersion: CURRENT_SYNC_SCHEMA_VERSION, issueId: input.issueId, targets: [] };
  }
}

export function writeSyncState(input: { root?: string; issueId: string; state: SyncState }) {
  const root = input.root ?? process.cwd();
  const { syncPath } = getSyncPaths(root, input.issueId);
  mkdirSync(dirname(syncPath), { recursive: true });
  writeFileSync(syncPath, `${JSON.stringify(input.state, null, 2)}\n`);
}

function normalizeSyncTarget(value: unknown): SyncTarget {
  const r = value as Record<string, unknown>;
  return {
    provider: (r.provider === "github" ? "github" : "linear") as "linear" | "github",
    externalId: String(r.externalId ?? ""),
    displayId: String(r.displayId ?? ""),
    url: String(r.url ?? ""),
    syncedAt: typeof r.syncedAt === "string" ? r.syncedAt : undefined,
    pendingPush: typeof r.pendingPush === "boolean" ? r.pendingPush : undefined,
    lastError:
      r.lastError && typeof r.lastError === "object"
        ? {
            message: String((r.lastError as Record<string, unknown>).message ?? ""),
            timestamp: String((r.lastError as Record<string, unknown>).timestamp ?? ""),
          }
        : undefined,
  };
}

export function logSyncError(input: {
  root?: string;
  issueId: string;
  provider: string;
  error: Error;
}) {
  const state = readSyncState(input);
  const target = state.targets.find((t) => t.provider === input.provider);
  if (target) {
    target.lastError = { message: input.error.message, timestamp: new Date().toISOString() };
    target.pendingPush = true;
    writeSyncState({ issueId: input.issueId, state });
  }
}

export function resolveSyncProvider(root?: string): SyncProvider | null {
  const provider = getSyncConfigValue(root, "sync.provider");
  if (provider !== "linear" && provider !== "github") return null;

  const autoSync = getSyncConfigValue(root, "sync.autoSync");
  if (autoSync === false) return null;

  if (provider === "linear") {
    return createLinearProvider(root);
  }
  return null;
}

function getRepoName(root?: string): string {
  const cwd = root ?? process.cwd();
  try {
    const remoteUrl = execSync("git remote get-url origin", {
      cwd,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
    }).trim();
    const match = remoteUrl.match(/[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
    if (match) return match[2];
  } catch {
    // not a git repo or no remote
  }
  return basename(cwd);
}

function createLinearProvider(root?: string): SyncProvider | null {
  // Verify linear CLI is available
  try {
    execSync("linear --version", { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"], env: { ...process.env, PATH: process.env.PATH } });
  } catch {
    return null;
  }

  const teamKey = String(getSyncConfigValue(root, "sync.linearTeamKey") ?? "");
  if (!teamKey) return null;

  const assigneeId = String(getSyncConfigValue(root, "sync.linearAssigneeId") ?? "");

  const runLinear = (args: string[]): Record<string, unknown> => {
    const cmd = `linear ${args.map((a) => (a.includes(" ") || a.includes("'") ? `"${a.replace(/"/g, '\\"')}"` : a)).join(" ")}`;
    const output = execSync(cmd, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, PATH: process.env.PATH },
    });
    return JSON.parse(output) as Record<string, unknown>;
  };

  const ensureLabel = (name: string) => {
    try {
      execSync(`linear label create --name "${name.replace(/"/g, '\\"')}" --color "#6B7280" --team ${teamKey}`, {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "ignore"],
        env: { ...process.env, PATH: process.env.PATH },
      });
    } catch {
      // Label may already exist; ignore error
    }
  };

  const withTempFile = <T>(content: string, fn: (path: string) => T): T => {
    const path = join(tmpdir(), `gxpm-${Date.now()}-${Math.random().toString(36).slice(2)}.md`);
    writeFileSync(path, content);
    try {
      return fn(path);
    } finally {
      try {
        unlinkSync(path);
      } catch {
        // ignore cleanup failure
      }
    }
  };

  return {
    name: "linear",

    async createIssue(issueId: string, issueType: string, title: string): Promise<SyncTarget> {
      const stateType = GXPM_PHASE_TO_LINEAR_STATE["triage"].type;
      const repoName = getRepoName(root);
      const repoLabel = `repo:${repoName}`;

      ensureLabel(repoLabel);

      const description = buildLinearDescription({
        issueId,
        issueType,
        phase: "triage",
        artifacts: [],
        repoName,
        root,
      });

      const result = withTempFile(description, (descPath) => {
        const args = [
          "issue", "create",
          "--json",
          "--title", title || `[${issueId}] ${issueType} issue`,
          "--team", teamKey,
          "--state", stateType,
          "--label", repoLabel,
          "--description-file", descPath,
        ];
        if (assigneeId) {
          args.push("--assignee", assigneeId);
        }
        return runLinear(args);
      });

      const success = result.success !== false;
      if (!success) {
        const error = (result.error as Record<string, unknown>)?.message ?? "Linear CLI issue create failed";
        throw new Error(`Linear CLI error: ${error}`);
      }

      return {
        provider: "linear",
        externalId: String(result.id ?? ""),
        displayId: String(result.identifier ?? ""),
        url: String(result.url ?? ""),
        syncedAt: new Date().toISOString(),
      };
    },

    async updatePhase(target: SyncTarget, phase: GxpmPhase): Promise<void> {
      const stateType = GXPM_PHASE_TO_LINEAR_STATE[phase]?.type;
      if (stateType) {
        runLinear(["issue", "move", target.displayId, stateType, "--json"]);
      }
    },

    async updateDescription(target: SyncTarget, description: string): Promise<void> {
      withTempFile(description, (descPath) => {
        runLinear(["issue", "update", target.displayId, "--description-file", descPath, "--json"]);
      });
    },

    async archiveIssue(target: SyncTarget, archived: boolean): Promise<void> {
      const stateType = archived ? "canceled" : "completed";
      runLinear(["issue", "move", target.displayId, stateType, "--json"]);
    },
  };
}

export async function maybeSyncIssue(input: {
  root?: string;
  issueId: string;
  action: "created" | "transitioned" | "artifact-written" | "archived";
  meta?: Record<string, unknown>;
}): Promise<void> {
  const root = input.root ?? process.cwd();
  const provider = resolveSyncProvider(root);
  if (!provider) return;

  const syncState = readSyncState({ root, issueId: input.issueId });
  let target = syncState.targets.find((t) => t.provider === provider.name);

  try {
    if (input.action === "created") {
      if (target) return; // Already linked
      const issueState = JSON.parse(
        readFileSync(getIssuePaths(root, input.issueId).statePath, "utf8"),
      ) as IssueState;
      target = await provider.createIssue(
        input.issueId,
        issueState.issueType ?? "feature",
        `[${input.issueId}] ${issueState.issueType ?? "feature"} issue`,
      );
      syncState.targets.push(target);
      writeSyncState({ root, issueId: input.issueId, state: syncState });
      return;
    }

    if (!target) return; // No binding yet; skip

    if (input.action === "transitioned") {
      const phase = String(input.meta?.toPhase ?? "") as GxpmPhase;
      await provider.updatePhase(target, phase);
      target.syncedAt = new Date().toISOString();
      target.pendingPush = false;
      target.lastError = undefined;
      writeSyncState({ root, issueId: input.issueId, state: syncState });
      return;
    }

    if (input.action === "artifact-written") {
      const syncArtifacts = getSyncConfigValue(root, "sync.syncArtifacts");
      if (syncArtifacts === false) return;

      const artifactIndexPath = getIssuePaths(root, input.issueId).artifactIndexPath;
      let artifacts: ArtifactRecord[] = [];
      if (existsSync(artifactIndexPath)) {
        const index = JSON.parse(readFileSync(artifactIndexPath, "utf8")) as { artifacts?: ArtifactRecord[] };
        artifacts = index.artifacts ?? [];
      }
      const state = JSON.parse(
        readFileSync(getIssuePaths(root, input.issueId).statePath, "utf8"),
      ) as IssueState;
      const description = buildLinearDescription({
        issueId: input.issueId,
        issueType: state.issueType ?? "feature",
        phase: state.currentPhase,
        artifacts,
        repoName: getRepoName(root),
        root,
      });
      await provider.updateDescription(target, description);
      target.syncedAt = new Date().toISOString();
      target.pendingPush = false;
      target.lastError = undefined;
      writeSyncState({ root, issueId: input.issueId, state: syncState });
      return;
    }

    if (input.action === "archived") {
      const archived = Boolean(input.meta?.archived);
      await provider.archiveIssue(target, archived);
      target.syncedAt = new Date().toISOString();
      target.pendingPush = false;
      target.lastError = undefined;
      writeSyncState({ root, issueId: input.issueId, state: syncState });
      return;
    }
  } catch (error) {
    logSyncError({ root, issueId: input.issueId, provider: provider.name, error: error as Error });
    // Silently fail — local state is truth
  }
}

function getSyncConfigValue(root: string | undefined, key: string): unknown {
  if (!isTestSyncIsolated()) {
    return getConfigValue({ root, key }).value;
  }
  const syncKey = key.replace(/^sync\./, "");
  return readRepoSyncConfig(root ?? process.cwd())[syncKey];
}

function isTestSyncIsolated(): boolean {
  return process.env.NODE_ENV === "test" && process.env.GXPM_TEST_ALLOW_LIVE_SYNC !== "1";
}

function readRepoSyncConfig(root: string): Record<string, unknown> {
  const configPath = join(root, ".gxpm", "config.json");
  if (!existsSync(configPath)) return {};
  try {
    const config = JSON.parse(readFileSync(configPath, "utf8")) as { sync?: unknown };
    if (!config.sync || typeof config.sync !== "object" || Array.isArray(config.sync)) {
      return {};
    }
    return config.sync as Record<string, unknown>;
  } catch {
    return {};
  }
}

const GXPM_PHASE_TO_LINEAR_STATE: Record<GxpmPhase, { type: string }> = {
  triage: { type: "triage" },
  plan: { type: "backlog" },
  dispatch: { type: "unstarted" },
  implement: { type: "started" },
  "local-verify": { type: "started" },
  "ac-check": { type: "started" },
  "self-review": { type: "started" },
  ship: { type: "started" },
  "pr-check": { type: "started" },
  verify: { type: "started" },
  qa: { type: "started" },
  land: { type: "completed" },
};

const GXPM_PHASE_TO_LINEAR_LABEL: Record<GxpmPhase, string> = {
  triage: "gxpm:phase/triage",
  plan: "gxpm:phase/plan",
  dispatch: "gxpm:phase/dispatch",
  implement: "gxpm:phase/implement",
  "local-verify": "gxpm:phase/local-verify",
  "ac-check": "gxpm:phase/ac-check",
  "self-review": "gxpm:phase/self-review",
  ship: "gxpm:phase/ship",
  "pr-check": "gxpm:phase/pr-check",
  verify: "gxpm:phase/verify",
  qa: "gxpm:phase/qa",
  land: "gxpm:phase/land",
};

function buildLinearDescription(input: {
  issueId: string;
  issueType: string;
  phase: GxpmPhase;
  artifacts: ArtifactRecord[];
  repoName?: string;
  root?: string;
}): string {
  const artifactList = input.artifacts
    .map((a) => `- \`${a.type}\` — written at ${a.writtenAt}`)
    .join("\n") || "- none yet";

  const repoLine = input.repoName ? `**Repository:** \`${input.repoName}\`\n` : "";
  const pathLine = input.root ? `**Local Path:** \`${input.root}\`\n` : "";

  return `## 🎯 gxpm Tracking Issue

**Local ID:** ${input.issueId}
${repoLine}${pathLine}**Type:** ${input.issueType}
**Phase:** ${input.phase}

---

### 📋 Artifacts
${artifactList}

---

> This issue is managed by gxpm. Local state at \`.gxpm/issues/${input.issueId}/\` is the source of truth.`;
}
