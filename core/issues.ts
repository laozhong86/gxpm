import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { GxpmPhase, IssueState } from "./state";

export interface IssueListEntry {
  issueId: string;
  currentPhase: GxpmPhase;
  createdAt: string;
  updatedAt: string;
  stateRoot: string;
  archived: boolean;
}

interface ListIssuesInput {
  root?: string;
  /** Show all issues (including land + archived). Default false. */
  includeAll?: boolean;
  /** Show only archived issues. Default false. Ignored if includeAll. */
  archivedOnly?: boolean;
}

export function listIssues(input: ListIssuesInput = {}): IssueListEntry[] {
  const root = input.root ?? process.cwd();
  const issuesDir = join(root, ".gxpm", "issues");

  if (!existsSync(issuesDir)) {
    return [];
  }

  const entries: IssueListEntry[] = [];

  for (const name of readdirSync(issuesDir)) {
    const issueDir = join(issuesDir, name);

    let isDir = false;
    try {
      isDir = statSync(issueDir).isDirectory();
    } catch {
      continue;
    }
    if (!isDir) continue;

    const statePath = join(issueDir, "state.json");
    if (!existsSync(statePath)) continue;

    let state: IssueState;
    try {
      state = JSON.parse(readFileSync(statePath, "utf8")) as IssueState;
    } catch {
      continue;
    }

    if (!state || typeof state !== "object" || !state.issueId) continue;

    const archived = state.archived === true;

    // Filter: default hides archived AND landed; --all overrides; --archived narrows to only archived.
    if (!input.includeAll) {
      if (input.archivedOnly) {
        if (!archived) continue;
      } else {
        if (archived) continue;
        if (state.currentPhase === "land") continue;
      }
    }

    entries.push({
      issueId: state.issueId,
      currentPhase: state.currentPhase,
      createdAt: state.createdAt,
      updatedAt: state.updatedAt,
      stateRoot: state.stateRoot,
      archived,
    });
  }

  entries.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  return entries;
}

/**
 * Pick next available GXPM-N id that does not already have a state.json.
 * Resolves the F-1 collision risk where agent hard-codes an id that's already taken.
 */
export function getNextAvailableIssueId(input: { root?: string; prefix?: string } = {}): string {
  const root = input.root ?? process.cwd();
  const prefix = input.prefix ?? "GXPM";
  const issuesDir = join(root, ".gxpm", "issues");

  if (!existsSync(issuesDir)) {
    return `${prefix}-1`;
  }

  let max = 0;
  const pattern = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-(\\d+)$`);

  for (const name of readdirSync(issuesDir)) {
    const m = name.match(pattern);
    if (m) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }

  return `${prefix}-${max + 1}`;
}

/**
 * Return the N most recently updated issues at phase=land (or any specified phase).
 * Useful when listIssues() default returns empty and a fresh session needs context.
 */
export function recentLandedIssues(input: { root?: string; limit?: number; phase?: string } = {}): IssueListEntry[] {
  const root = input.root ?? process.cwd();
  const limit = input.limit ?? 5;
  const targetPhase = input.phase ?? "land";

  const all = listIssues({ root, includeAll: true });
  return all.filter((e) => e.currentPhase === targetPhase).slice(0, limit);
}
