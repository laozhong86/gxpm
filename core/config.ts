import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type WorktreeEnforcement = "required" | "forbidden" | "optional" | "unset";
export type WorktreeDefault = "use" | "skip" | "ask";
export type ConfigValueSource = "config-repo" | "config-global" | "env" | "default" | "unset";

export interface ConfigEntry {
  key: KnownConfigKey;
  value: unknown;
  source: ConfigValueSource;
  description: string;
}

export interface WorktreePolicy {
  enforcement: WorktreeEnforcement;
  default: WorktreeDefault;
  source: PolicySource;
}

export type PolicySource =
  | "config-repo"
  | "config-global"
  | "user-message"
  | "agents-md"
  | "default";

export interface ResolveWorktreePolicyInput {
  /** Repo root (defaults to cwd). */
  root?: string;
  /** Override $HOME. */
  home?: string;
  /**
   * Whether the user explicitly stated worktree preference in this conversation.
   * The CLI itself can't know this — the LLM must pass it in.
   */
  userMessage?: { enforcement?: WorktreeEnforcement; default?: WorktreeDefault };
  /** Explicit AGENTS.md content (testing). Otherwise read from repo. */
  agentsMdContent?: string;
}

export type SyncProvider = "linear" | "github" | "none";

interface ConfigDoc {
  worktree?: {
    enforcement?: WorktreeEnforcement;
    default?: WorktreeDefault;
  };
  workspace?: {
    root?: string;
    basePort?: number;
  };
  update_check?: boolean;
  sync?: {
    provider?: SyncProvider;
    linearTeamId?: string;
    linearTeamKey?: string;
    autoSync?: boolean;
    syncArtifacts?: boolean;
  };
  [k: string]: unknown;
}

const CONFIG_FILENAME = "config.json";
const WORKTREE_ENFORCEMENT_VALUES = ["required", "forbidden", "optional", "unset"] as const;
const WORKTREE_DEFAULT_VALUES = ["use", "skip", "ask"] as const;
const SYNC_PROVIDER_VALUES = ["linear", "github", "none"] as const;

function getGxpmHome(): string {
  const envHome = process.env.GXPM_HOME;
  if (envHome && envHome.trim()) return envHome.trim();
  return homedir();
}

function getRepoConfigPath(root: string): string {
  const envPath = process.env.GXPM_CONFIG_PATH;
  if (envPath && envPath.trim()) return envPath.trim();
  return join(root, ".gxpm", CONFIG_FILENAME);
}

const CONFIG_REGISTRY = {
  "worktree.enforcement": {
    defaultValue: "optional" satisfies WorktreeEnforcement,
    description: "Worktree policy enforcement: required, forbidden, optional, or unset.",
    normalize: (value: unknown) => normalizeEnum("worktree.enforcement", value, WORKTREE_ENFORCEMENT_VALUES),
  },
  "worktree.default": {
    defaultValue: "ask" satisfies WorktreeDefault,
    description: "Default worktree choice when enforcement is optional: use, skip, or ask.",
    normalize: (value: unknown) => normalizeEnum("worktree.default", value, WORKTREE_DEFAULT_VALUES),
  },
  "workspace.root": {
    defaultValue: ".gxpm/local/workspaces",
    description: "Default root for gxpm-managed per-issue execution workspaces.",
    normalize: (value: unknown) => normalizeNonEmptyString("workspace.root", value),
  },
  "workspace.basePort": {
    defaultValue: 3090,
    description: "Base port for deterministic dev server port allocation in workspaces.",
    normalize: (value: unknown) => normalizePositiveInteger("workspace.basePort", value),
  },
  update_check: {
    defaultValue: true,
    description: "Whether gxpm-update-check should check the remote VERSION.",
    normalize: normalizeBoolean,
  },
  "sync.provider": {
    defaultValue: "none" satisfies SyncProvider,
    description: "Issue tracker sync provider: linear, github, or none.",
    normalize: (value: unknown) => normalizeEnum("sync.provider", value, SYNC_PROVIDER_VALUES),
  },
  "sync.linearTeamId": {
    defaultValue: "",
    description: "Linear team ID (UUID) for issue creation.",
    normalize: (value: unknown) => (typeof value === "string" ? value : ""),
  },
  "sync.linearTeamKey": {
    defaultValue: "",
    description: "Linear team key (e.g., ENG) used in issue identifiers.",
    normalize: (value: unknown) => (typeof value === "string" ? value : ""),
  },
  "sync.autoSync": {
    defaultValue: true,
    description: "Automatically sync local state to the configured issue tracker.",
    normalize: normalizeBoolean,
  },
  "sync.syncArtifacts": {
    defaultValue: true,
    description: "Sync artifact summaries to the issue tracker description.",
    normalize: normalizeBoolean,
  },
  "sync.linearAssigneeId": {
    defaultValue: "",
    description: "Linear user ID to assign as default assignee for synced issues.",
    normalize: (value: unknown) => (typeof value === "string" ? value : ""),
  },
  "agent.name": {
    defaultValue: "",
    description: "Human-readable agent identity used as issue creator/assignee name. Falls back to host name if empty.",
    normalize: (value: unknown) => (typeof value === "string" ? value : ""),
  },
} as const;

export type KnownConfigKey = keyof typeof CONFIG_REGISTRY;
export const KNOWN_CONFIG_KEYS = Object.keys(CONFIG_REGISTRY) as KnownConfigKey[];

function repoConfigPath(root: string) {
  return getRepoConfigPath(root);
}
function globalConfigPath(home: string) {
  return join(home, ".gxpm", CONFIG_FILENAME);
}

function readConfig(path: string): ConfigDoc {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8")) as ConfigDoc;
  } catch {
    return {};
  }
}

function writeConfig(path: string, doc: ConfigDoc) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(doc, null, 2) + "\n");
}

function getEnvConfigValue(key: string): unknown | undefined {
  const envMap: Record<string, string> = {
    "sync.provider": "GXPM_SYNC_PROVIDER",
    "sync.linearTeamId": "GXPM_LINEAR_TEAM_ID",
    "sync.linearTeamKey": "GXPM_LINEAR_TEAM_KEY",
    "sync.linearAssigneeId": "GXPM_LINEAR_ASSIGNEE_ID",
    "sync.autoSync": "GXPM_AUTO_SYNC",
    "sync.syncArtifacts": "GXPM_SYNC_ARTIFACTS",
    "worktree.enforcement": "GXPM_WORKTREE_ENFORCEMENT",
    "worktree.default": "GXPM_WORKTREE_DEFAULT",
    "workspace.root": "GXPM_WORKSPACE_ROOT",
    "workspace.basePort": "GXPM_WORKSPACE_BASE_PORT",
    update_check: "GXPM_UPDATE_CHECK",
    "agent.name": "GXPM_AGENT_NAME",
  };
  const envKey = envMap[key];
  if (!envKey) return undefined;
  const raw = process.env[envKey];
  if (raw === undefined) return undefined;
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (/^-?\d+$/.test(raw)) return Number(raw);
  return raw;
}

export function getConfigValue(input: { root?: string; home?: string; key: string }): {
  value: unknown;
  source: "config-repo" | "config-global" | "env" | "unset";
} {
  const root = input.root ?? process.cwd();
  // Check env var override first for select keys
  const envVal = getEnvConfigValue(input.key);
  if (envVal !== undefined) return { value: envVal, source: "env" };

  const repo = readConfig(repoConfigPath(root));
  const repoVal = lookup(repo, input.key);
  if (repoVal !== undefined) return { value: repoVal, source: "config-repo" };
  const global = readConfig(globalConfigPath(input.home ?? homedir()));
  const globalVal = lookup(global, input.key);
  if (globalVal !== undefined) return { value: globalVal, source: "config-global" };
  return { value: undefined, source: "unset" };
}

export function getResolvedConfigValue(input: { root?: string; home?: string; key: string }): {
  value: unknown;
  source: ConfigValueSource;
} {
  assertKnownConfigKey(input.key);
  const explicit = getConfigValue(input);
  if (explicit.value !== undefined) {
    return { value: explicit.value, source: explicit.source };
  }
  return { value: CONFIG_REGISTRY[input.key].defaultValue, source: "default" };
}

export function setConfigValue(input: {
  root?: string;
  home?: string;
  scope: "repo" | "global";
  key: string;
  value: unknown;
}) {
  assertKnownConfigKey(input.key);
  const path =
    input.scope === "repo"
      ? repoConfigPath(input.root ?? process.cwd())
      : globalConfigPath(input.home ?? homedir());
  const doc = readConfig(path);
  assign(doc, input.key, normalizeConfigValue(input.key, input.value));
  writeConfig(path, doc);
  return path;
}

export function listConfig(input: { root?: string; home?: string } = {}): {
  repo: ConfigDoc;
  global: ConfigDoc;
} {
  return {
    repo: readConfig(repoConfigPath(input.root ?? process.cwd())),
    global: readConfig(globalConfigPath(input.home ?? homedir())),
  };
}

export function listConfigEntries(input: { root?: string; home?: string } = {}): ConfigEntry[] {
  return KNOWN_CONFIG_KEYS.map((key) => {
    const resolved = getResolvedConfigValue({ ...input, key });
    return {
      key,
      value: resolved.value,
      source: resolved.source,
      description: CONFIG_REGISTRY[key].description,
    };
  });
}

/**
 * Parse a `## gxpm Config` block from AGENTS.md content. Recognizes lines like
 *   - worktree.enforcement: required
 *   - worktree.default: use
 * Returns the partial config (or {} when no block found / no recognized keys).
 */
export function parseAgentsMdConfig(content: string): ConfigDoc {
  const lines = content.split("\n");
  let inSection = false;
  const sectionLines: string[] = [];
  const headingPattern = /^##\s+gxpm\s+config\s*$/i;
  const nextHeadingPattern = /^##\s/;

  for (const line of lines) {
    if (!inSection) {
      if (headingPattern.test(line)) {
        inSection = true;
      }
      continue;
    }
    if (nextHeadingPattern.test(line)) break;
    sectionLines.push(line);
  }

  if (!inSection || sectionLines.length === 0) return {};

  const doc: ConfigDoc = {};
  for (const line of sectionLines) {
    const m = line.match(/^\s*[-*]?\s*([a-zA-Z][a-zA-Z0-9_.]*)\s*:\s*([^\n#]+?)\s*$/);
    if (!m) continue;
    const key = m[1];
    const valueRaw = m[2].trim().replace(/^["']|["']$/g, "");
    if (!isKnownConfigKey(key)) continue;
    assign(doc, key, normalizeConfigValue(key, normalizeValue(valueRaw)));
  }
  return doc;
}

/**
 * Resolve worktree policy through the precedence chain:
 *   1. config.json (repo > global) — hard-coded by maintainer, wins everything
 *   2. user message (passed in) — current conversation override
 *   3. AGENTS.md `## gxpm Config` block — repo convention
 *   4. default: enforcement=optional, default=ask
 */
export function resolveWorktreePolicy(
  input: ResolveWorktreePolicyInput = {},
): WorktreePolicy {
  const root = input.root ?? process.cwd();
  const home = input.home ?? homedir();

  // 1. config.json (repo wins over global)
  const cfgEnforce = getConfigValue({ root, home, key: "worktree.enforcement" });
  const cfgDefault = getConfigValue({ root, home, key: "worktree.default" });
  if (cfgEnforce.value !== undefined) {
    return {
      enforcement: cfgEnforce.value as WorktreeEnforcement,
      default: ((cfgDefault.value as WorktreeDefault) ?? "ask") as WorktreeDefault,
      source: cfgEnforce.source,
    };
  }

  // 2. user message
  if (input.userMessage?.enforcement !== undefined) {
    return {
      enforcement: input.userMessage.enforcement,
      default: input.userMessage.default ?? "ask",
      source: "user-message",
    };
  }

  // 3. AGENTS.md
  const agents = input.agentsMdContent ?? readAgentsMd(root);
  if (agents) {
    const parsed = parseAgentsMdConfig(agents);
    const wt = (parsed.worktree ?? {}) as { enforcement?: WorktreeEnforcement; default?: WorktreeDefault };
    if (wt.enforcement !== undefined) {
      return {
        enforcement: wt.enforcement,
        default: wt.default ?? "ask",
        source: "agents-md",
      };
    }
  }

  // 4. default
  return { enforcement: "optional", default: "ask", source: "default" };
}

function readAgentsMd(root: string): string | null {
  const path = join(root, "AGENTS.md");
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

function lookup(doc: Record<string, unknown>, key: string): unknown {
  const parts = key.split(".");
  let cur: any = doc;
  for (const p of parts) {
    if (cur && typeof cur === "object" && p in cur) cur = cur[p];
    else return undefined;
  }
  return cur;
}

function assign(doc: Record<string, unknown>, key: string, value: unknown) {
  const parts = key.split(".");
  let cur: any = doc;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const p = parts[i];
    if (typeof cur[p] !== "object" || cur[p] === null) cur[p] = {};
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
}

function isKnownConfigKey(key: string): key is KnownConfigKey {
  return key in CONFIG_REGISTRY;
}

function assertKnownConfigKey(key: string): asserts key is KnownConfigKey {
  if (!isKnownConfigKey(key)) {
    throw new Error(`Unknown config key: ${key}`);
  }
}

function normalizeConfigValue(key: KnownConfigKey, value: unknown) {
  return CONFIG_REGISTRY[key].normalize(value as never);
}

function normalizeBoolean(value: unknown) {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error("update_check must be true or false");
}

function normalizeNonEmptyString(key: string, value: unknown) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${key} must be a non-empty string`);
  }
  return value;
}

function normalizePositiveInteger(key: string, value: unknown) {
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed >= 1) return parsed;
  }
  if (typeof value === "number" && Number.isInteger(value) && value >= 1) {
    return value;
  }
  throw new Error(`${key} must be a positive integer`);
}

function normalizeEnum<T extends readonly string[]>(key: string, value: unknown, allowed: T): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new Error(`${key} must be one of: ${allowed.join(", ")}`);
  }
  return value as T[number];
}

function normalizeValue(raw: string): unknown {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (/^-?\d+$/.test(raw)) return Number(raw);
  return raw;
}
