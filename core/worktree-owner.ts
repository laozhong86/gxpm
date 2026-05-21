/**
 * Worktree owner marker and passive context recovery.
 *
 * Problem: After multi-turn context compaction, an AI agent may forget the
 * current issue and worktree. These files let the agent recover passively
 * from the filesystem without needing to remember the issue id.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
  /** GXPM-187: skill the agent must invoke before doing phase work */
  requiredSkill?: string;
  /** GXPM-187: most recent commits on the worktree branch, newest first */
  recentCommits?: Array<{ sha: string; subject: string }>;
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
  if (existsSync(join(workspacePath, ".gxpm-worktree", "env.sh"))) {
    lines.push(`## Worktree 工具链`);
    lines.push(``);
    lines.push(`运行 package-manager 或 GitNexus 命令前，先加载 worktree 本地工具链：`);
    lines.push(``);
    lines.push(`\`\`\`bash`);
    lines.push(`source .gxpm-worktree/env.sh`);
    lines.push(`gxpm gitnexus status`);
    lines.push(`# 如果缺少精确 worktree 索引：gxpm gitnexus index`);
    lines.push(`\`\`\``);
    lines.push(``);
  }
  if (data.requiredSkill) {
    lines.push(`## 必须先加载的 skill`);
    lines.push(``);
    lines.push(`当前阶段进入前 agent 必须加载：\`${data.requiredSkill}\`，再做任何代码或 artifact 写入。`);
    lines.push(``);
  }
  if (data.recentCommits && data.recentCommits.length > 0) {
    lines.push(`## 最近 commit`);
    lines.push(``);
    for (const c of data.recentCommits) {
      lines.push(`- \`${c.sha.slice(0, 7)}\` ${c.subject}`);
    }
    lines.push(``);
  }
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

/**
 * GXPM-187: single entry point for writing worktree identity files.
 *
 * Replaces ad-hoc call pairs of writeWorktreeOwnerMarker + writeIssueContextMd
 * scattered across worktree-init-steps and scripts/commands/issue. Adds:
 *
 *   1. ownerIssueId conflict guard — refuses to overwrite a marker that
 *      already belongs to a different issue.
 *   2. createdAt preservation across re-runs (only updatedAt is refreshed).
 *   3. worktree.identity.written event appended to
 *      `<repoRoot>/.gxpm/issues/<issueId>/events.jsonl` so the bootstrap
 *      audit script (slice 1) can prove the file was actually written.
 */
export interface EnsureWorktreeIdentityInput {
  repoRoot: string;
  workspacePath: string;
  issueId: string;
  currentPhase: string;
  branchName?: string;
  title?: string;
  nextPhase?: string;
  requiredSkill?: string | null;
  recentCommits?: Array<{ sha: string; subject: string }>;
  resumeHint?: string;
}

export interface EnsureWorktreeIdentityResult {
  created: boolean;
  createdAt: string;
  updatedAt: string;
}

export function ensureWorktreeIdentity(
  input: EnsureWorktreeIdentityInput,
): EnsureWorktreeIdentityResult {
  const existing = readWorktreeOwner(input.workspacePath);
  if (existing && existing.ownerIssueId && existing.ownerIssueId !== input.issueId) {
    throw new Error(
      `owner issue id mismatch at ${input.workspacePath}: existing=${existing.ownerIssueId} requested=${input.issueId}`,
    );
  }

  const now = new Date().toISOString();
  const createdAt = existing?.createdAt ?? now;
  const created = existing === null;

  writeWorktreeOwnerMarker(input.workspacePath, {
    ownerIssueId: input.issueId,
    linkedIssues: existing?.linkedIssues ?? [],
    createdAt,
    updatedAt: now,
    currentPhase: input.currentPhase,
    title: input.title ?? existing?.title,
    branchName: input.branchName ?? existing?.branchName,
    workspacePath: input.workspacePath,
  });

  writeIssueContextMd(input.workspacePath, {
    issueId: input.issueId,
    title: input.title,
    currentPhase: input.currentPhase,
    nextPhase: input.nextPhase,
    branchName: input.branchName,
    workspacePath: input.workspacePath,
    updatedAt: now,
    resumeHint: input.resumeHint,
    requiredSkill: input.requiredSkill ?? undefined,
    recentCommits: input.recentCommits,
  });

  const issueDir = join(input.repoRoot, ".gxpm", "issues", input.issueId);
  if (!existsSync(issueDir)) mkdirSync(issueDir, { recursive: true });
  const event = {
    schemaVersion: 1,
    type: "worktree.identity.written",
    issueId: input.issueId,
    timestamp: now,
    payload: {
      worktreePath: input.workspacePath,
      branchName: input.branchName,
      currentPhase: input.currentPhase,
      created,
      requiredSkill: input.requiredSkill ?? null,
      recentCommitCount: input.recentCommits?.length ?? 0,
    },
  };
  appendFileSync(join(issueDir, "events.jsonl"), `${JSON.stringify(event)}\n`);

  return { created, createdAt, updatedAt: now };
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
