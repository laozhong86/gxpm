import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
  const provider = getConfigValue({ root, key: "sync.provider" }).value;
  if (provider !== "linear" && provider !== "github") return null;

  const autoSync = getConfigValue({ root, key: "sync.autoSync" }).value;
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
  const apiKey = process.env.GXPM_LINEAR_API_KEY ?? "";
  if (!apiKey) return null;

  const teamId = String(getConfigValue({ root, key: "sync.linearTeamId" }).value ?? "");
  const teamKey = String(getConfigValue({ root, key: "sync.linearTeamKey" }).value ?? "");

  const graphQL = async (query: string, variables?: Record<string, unknown>) => {
    const res = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: apiKey,
      },
      body: JSON.stringify({ query, variables }),
    });
    const json = (await res.json()) as Record<string, unknown>;
    if (json.errors) {
      const errors = Array.isArray(json.errors)
        ? json.errors.map((e: unknown) => (e as { message?: string }).message ?? String(e)).join("; ")
        : String(json.errors);
      throw new Error(`Linear API error: ${errors}`);
    }
    return json.data as Record<string, unknown>;
  };

  const workflowStatesCache = new Map<string, Array<{ id: string; name: string; type: string }>>();
  const labelCache = new Map<string, string>();

  const getWorkflowStates = async (): Promise<Array<{ id: string; name: string; type: string }>> => {
    if (!teamId) return [];
    if (workflowStatesCache.has(teamId)) return workflowStatesCache.get(teamId)!;
    const data = await graphQL(`
      query WorkflowStates($teamId: ID!) {
        team(id: $teamId) {
          states {
            nodes { id name type }
          }
        }
      }
    `, { teamId });
    const states = ((data?.team as Record<string, unknown>)?.states as Record<string, unknown>)?.nodes as
      | Array<{ id: string; name: string; type: string }>
      | undefined;
    const result = states ?? [];
    workflowStatesCache.set(teamId, result);
    return result;
  };

  const resolveStateId = async (phase: GxpmPhase): Promise<string | null> => {
    const states = await getWorkflowStates();
    const mapping = GXPM_PHASE_TO_LINEAR_STATE[phase];
    if (!mapping) return null;
    const match = states.find((s) => s.type === mapping.type);
    return match?.id ?? null;
  };

  async function getLabelId(name: string): Promise<string | undefined> {
    if (labelCache.has(name)) return labelCache.get(name);
    try {
      const data = await graphQL(`
        query IssueLabels($filter: IssueLabelFilter) {
          issueLabels(filter: $filter) { nodes { id name } }
        }
      `, { filter: { name: { eq: name } } });
      const labels = (data?.issueLabels as Record<string, unknown>)?.nodes as
        | Array<{ id: string; name: string }>
        | undefined;
      const id = labels?.[0]?.id;
      if (id) labelCache.set(name, id);
      return id;
    } catch {
      return undefined;
    }
  }

  async function ensureLabelExists(name: string) {
    try {
      await graphQL(`
        mutation LabelCreate($input: IssueLabelCreateInput!) {
          issueLabelCreate(input: $input) { success }
        }
      `, { input: { name, color: "#6B7280" } });
    } catch {
      // Label may already exist; ignore error
    }
  }

  return {
    name: "linear",

    async createIssue(issueId: string, issueType: string, title: string): Promise<SyncTarget> {
      const stateId = teamId ? await resolveStateId("triage") : undefined;
      const repoName = getRepoName(root);
      const repoLabelName = `repo:${repoName}`;
      await ensureLabelExists(repoLabelName);
      const repoLabelId = await getLabelId(repoLabelName);

      const data = await graphQL(`
        mutation IssueCreate($input: IssueCreateInput!) {
          issueCreate(input: $input) {
            success
            issue {
              id
              identifier
              url
              state { id name }
            }
          }
        }
      `, {
        input: {
          teamId: teamId || undefined,
          title: title || `[${issueId}] ${issueType} issue`,
          description: buildLinearDescription({ issueId, issueType, phase: "triage", artifacts: [], repoName, root }),
          ...(stateId ? { stateId } : {}),
          ...(repoLabelId ? { labelIds: [repoLabelId] } : {}),
        },
      });
      const issue = (data?.issueCreate as Record<string, unknown>)?.issue as Record<string, unknown>;
      return {
        provider: "linear",
        externalId: String(issue?.id ?? ""),
        displayId: String(issue?.identifier ?? ""),
        url: String(issue?.url ?? ""),
        syncedAt: new Date().toISOString(),
      };
    },

    async updatePhase(target: SyncTarget, phase: GxpmPhase): Promise<void> {
      const stateId = await resolveStateId(phase);
      const labelName = GXPM_PHASE_TO_LINEAR_LABEL[phase];

      // Update state
      if (stateId) {
        await graphQL(`
          mutation IssueUpdate($id: String!, $input: IssueUpdateInput!) {
            issueUpdate(id: $id, input: $input) {
              success
            }
          }
        `, { id: target.externalId, input: { stateId } });
      }

      // Manage phase label
      if (labelName) {
        const shortName = labelName.replace("gxpm:phase/", "");
        await ensureLabelExists(shortName);
        const labelId = await getLabelId(shortName);
        if (labelId) {
          await graphQL(`
            mutation IssueLabel($id: String!, $labelIds: [String!]!) {
              issueUpdate(id: $id, input: { labelIds: $labelIds }) {
                success
              }
            }
          `, {
            id: target.externalId,
            labelIds: [labelId],
          });
        }
      }
    },

    async updateDescription(target: SyncTarget, description: string): Promise<void> {
      await graphQL(`
        mutation IssueUpdate($id: String!, $input: IssueUpdateInput!) {
          issueUpdate(id: $id, input: $input) {
            success
          }
        }
      `, { id: target.externalId, input: { description } });
    },

    async archiveIssue(target: SyncTarget, archived: boolean): Promise<void> {
      const states = await getWorkflowStates();
      const type = archived ? "canceled" : "completed";
      const match = states.find((s) => s.type === type);
      if (match) {
        await graphQL(`
          mutation IssueUpdate($id: String!, $input: IssueUpdateInput!) {
            issueUpdate(id: $id, input: $input) {
              success
            }
          }
        `, { id: target.externalId, input: { stateId: match.id } });
      }
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
      const syncArtifacts = getConfigValue({ root, key: "sync.syncArtifacts" }).value;
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
