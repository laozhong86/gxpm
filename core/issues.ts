import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { GxpmPhase, IssueState } from "./state";

export interface IssueListEntry {
  issueId: string;
  currentPhase: GxpmPhase;
  createdAt: string;
  updatedAt: string;
  stateRoot: string;
}

interface ListIssuesInput {
  root?: string;
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
      // skip corrupt or non-json state files
      continue;
    }

    if (!state || typeof state !== "object" || !state.issueId) continue;

    entries.push({
      issueId: state.issueId,
      currentPhase: state.currentPhase,
      createdAt: state.createdAt,
      updatedAt: state.updatedAt,
      stateRoot: state.stateRoot,
    });
  }

  entries.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  return entries;
}
