/**
 * Worktree owner marker and passive context recovery.
 *
 * Problem: After multi-turn context compaction, an AI agent may forget the
 * current issue and worktree. These files let the agent recover passively
 * from the filesystem without needing to remember the issue id.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface WorktreeOwner {
  ownerIssueId: string;
  linkedIssues: string[];
  createdAt: string;
  /** Current issue phase (v2) */
  currentPhase?: string;
  /** Issue title or checkpoint title (v2) */
  title?: string;
  /** Last update timestamp (v2) */
  updatedAt?: string;
  /** Git branch name (v2) */
  branchName?: string;
  /** Absolute workspace path (v2) */
  workspacePath?: string;
}

export function readWorktreeOwner(cwd: string): WorktreeOwner | null {
  try {
    const path = join(cwd, ".gxpm-worktree-owner.json");
    if (!existsSync(path)) return null;
    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    const ownerIssueId = typeof raw.ownerIssueId === "string" ? raw.ownerIssueId : "";
    const linkedIssues = Array.isArray(raw.linkedIssues)
      ? raw.linkedIssues.filter((item): item is string => typeof item === "string")
      : [];
    const createdAt = typeof raw.createdAt === "string" ? raw.createdAt : "";
    if (!ownerIssueId || !createdAt) return null;
    return {
      ownerIssueId,
      linkedIssues,
      createdAt,
      currentPhase: typeof raw.currentPhase === "string" ? raw.currentPhase : undefined,
      title: typeof raw.title === "string" ? raw.title : undefined,
      updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : undefined,
      branchName: typeof raw.branchName === "string" ? raw.branchName : undefined,
      workspacePath: typeof raw.workspacePath === "string" ? raw.workspacePath : undefined,
    };
  } catch {
    return null;
  }
}

export function writeWorktreeOwnerMarker(
  workspacePath: string,
  marker: Omit<WorktreeOwner, "createdAt"> & Partial<Pick<WorktreeOwner, "createdAt">>,
): void {
  const fullMarker: WorktreeOwner = {
    linkedIssues: marker.linkedIssues,
    createdAt: marker.createdAt ?? new Date().toISOString(),
    ownerIssueId: marker.ownerIssueId,
    currentPhase: marker.currentPhase,
    title: marker.title,
    updatedAt: marker.updatedAt ?? new Date().toISOString(),
    branchName: marker.branchName,
    workspacePath: marker.workspacePath,
  };
  writeFileSync(
    join(workspacePath, ".gxpm-worktree-owner.json"),
    `${JSON.stringify(fullMarker, null, 2)}\n`,
  );
}

export interface IssueContextMdData {
  issueId: string;
  title?: string;
  currentPhase: string;
  nextPhase?: string;
  branchName?: string;
  workspacePath: string;
  updatedAt: string;
  resumeHint?: string;
}

export function writeIssueContextMd(workspacePath: string, data: IssueContextMdData): void {
  const lines: string[] = [
    `# ISSUE_CONTEXT — ${data.issueId}`,
    ``,
    `> 这是 gxpm 自动生成的上下文恢复文件。`,
    `> 如果 AI 代理忘记了当前正在处理的 issue，请阅读此文件。`,
    ``,
    `- **Issue ID**: \`${data.issueId}\``,
    `- **当前阶段**: \`${data.currentPhase}\``,
  ];
  if (data.title) {
    lines.push(`- **标题**: ${data.title}`);
  }
  if (data.branchName) {
    lines.push(`- **分支**: \`${data.branchName}\``);
  }
  lines.push(`- **工作目录**: \`${data.workspacePath}\``);
  lines.push(`- **更新时间**: ${data.updatedAt}`);
  lines.push(``);
  lines.push(`## 快速恢复`);
  lines.push(``);
  lines.push(`如果你忘记了当前 issue，运行以下命令恢复上下文：`);
  lines.push(``);
  lines.push(`\`\`\`bash`);
  lines.push(`gxpm issue context --auto`);
  lines.push(`\`\`\``);
  lines.push(``);
  if (data.nextPhase) {
    lines.push(`## 下一步`);
    lines.push(``);
    lines.push(`下一阶段: \`${data.nextPhase}\``);
    lines.push(``);
  }
  if (data.resumeHint) {
    lines.push(`## 续做提示`);
    lines.push(``);
    lines.push(data.resumeHint);
    lines.push(``);
  }
  lines.push(`---`);
  lines.push(`*此文件由 gxpm 自动生成，请勿手动编辑。*`);

  writeFileSync(join(workspacePath, "ISSUE_CONTEXT.md"), lines.join("\n") + "\n");
}

export function removeIssueContextMd(workspacePath: string): void {
  try {
    const path = join(workspacePath, "ISSUE_CONTEXT.md");
    if (existsSync(path)) {
      // Leave the file but mark it as stale so the agent doesn't trust it
      const content = readFileSync(path, "utf8");
      if (!content.includes("[STALE]")) {
        writeFileSync(path, `# [STALE] ${content.replace(/^# /, "")}`, "utf8");
      }
    }
  } catch {
    // best-effort
  }
}
