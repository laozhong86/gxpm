import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { listIssues } from "../core/issues";
import { PHASE_GATE_RULES } from "../core/phase-gates";
import type { GxpmPhase, IssueState } from "../core/state";

export const DEFAULT_PHASE_THRESHOLDS_DAYS: Partial<Record<GxpmPhase, number>> = {
  specify: 7,
  implement: 14,
  verify: 3,
};

export interface DoctorIssuesCheck {
  name: string;
  status: "ok" | "warn" | "fail";
  message: string;
  issueId?: string;
  worktreePath?: string;
}

export interface DoctorIssuesReport {
  schema_version: number;
  status: "healthy" | "warnings" | "error";
  health_score: number;
  checks: DoctorIssuesCheck[];
}

export interface RunDoctorIssuesInput {
  root?: string;
  now?: Date;
  phaseThresholdsDays?: Partial<Record<GxpmPhase, number>>;
  fix?: boolean;
  fixAggressive?: boolean;
  since?: string;
  auditLogPath?: string;
}

const DEFAULT_AUDIT_LOG_PATH = join(homedir(), ".gxpm", "audit", "doctor-issues-fixes.jsonl");

function parseSinceToMs(since: string): number | undefined {
  const m = since.trim().match(/^(\d+)\s*(d|h|m)$/);
  if (!m) return undefined;
  const n = Number(m[1]);
  switch (m[2]) {
    case "d":
      return n * 24 * 60 * 60 * 1000;
    case "h":
      return n * 60 * 60 * 1000;
    case "m":
      return n * 60 * 1000;
    default:
      return undefined;
  }
}

function buildIssueIdAllowList(root: string, sinceMs: number, now: Date): Set<string> | undefined {
  const issuesDir = join(root, ".gxpm", "issues");
  if (!existsSync(issuesDir)) return new Set();
  const cutoff = now.getTime() - sinceMs;
  const allowed = new Set<string>();
  for (const name of readdirSync(issuesDir)) {
    const statePath = join(issuesDir, name, "state.json");
    if (!existsSync(statePath)) continue;
    try {
      const st = statSync(statePath);
      if (st.mtime.getTime() >= cutoff) {
        allowed.add(name);
      }
    } catch {
      continue;
    }
  }
  return allowed;
}

const ISSUE_ID_PATTERN = /[A-Z][A-Z0-9]*-\d+/;

export function runDoctorIssues(input: RunDoctorIssuesInput = {}): DoctorIssuesReport {
  const root = input.root ?? process.cwd();
  const now = input.now ?? new Date();
  const thresholds = { ...DEFAULT_PHASE_THRESHOLDS_DAYS, ...(input.phaseThresholdsDays ?? {}) };
  const checks: DoctorIssuesCheck[] = [];

  let issueAllowList: Set<string> | undefined;
  if (input.since) {
    const ms = parseSinceToMs(input.since);
    if (typeof ms === "number") {
      issueAllowList = buildIssueIdAllowList(root, ms, now);
    }
  }

  const ctx: ScanContext = { root, allowList: issueAllowList };

  appendDanglingWorktreeChecks(ctx, checks, {
    fix: input.fix === true,
    auditLogPath: input.auditLogPath ?? DEFAULT_AUDIT_LOG_PATH,
  });
  appendPhaseStaleChecks(ctx, now, thresholds, checks);
  appendMissingArtifactChecks(ctx, checks);
  appendHandoffBrokenChecks(ctx, checks);

  if (input.fixAggressive) {
    checks.push({
      name: "fix_aggressive_unsupported",
      status: "warn",
      message: "--fix-aggressive is not yet implemented; only conservative fixes ran",
    });
  }

  let score = 100;
  for (const c of checks) {
    if (c.status === "fail") score -= 20;
    else if (c.status === "warn") score -= 5;
  }
  score = Math.max(0, score);

  const hasFail = checks.some((c) => c.status === "fail");
  const hasWarn = checks.some((c) => c.status === "warn");
  const status: DoctorIssuesReport["status"] = hasFail ? "error" : hasWarn ? "warnings" : "healthy";

  return {
    schema_version: 1,
    status,
    health_score: score,
    checks,
  };
}

interface ScanContext {
  root: string;
  /** When defined, only issue ids in this set are considered. */
  allowList?: Set<string>;
}

function isAllowed(ctx: ScanContext, issueId: string): boolean {
  return !ctx.allowList || ctx.allowList.has(issueId);
}

function appendDanglingWorktreeChecks(
  ctx: ScanContext,
  checks: DoctorIssuesCheck[],
  opts: { fix: boolean; auditLogPath: string },
) {
  const worktreesDir = join(ctx.root, ".gxpm", "worktrees");
  if (!existsSync(worktreesDir)) return;

  const issues = listIssues({ root: ctx.root, includeAll: true });
  const terminalIssueIds = new Set(
    issues.filter((i) => i.archived || i.currentPhase === "land").map((i) => i.issueId),
  );

  for (const wtName of readdirSync(worktreesDir)) {
    const wtPath = join(worktreesDir, wtName);
    try {
      if (!statSync(wtPath).isDirectory()) continue;
    } catch {
      continue;
    }

    const idMatch = wtName.match(ISSUE_ID_PATTERN);
    if (!idMatch) continue;
    const issueId = idMatch[0];

    if (!isAllowed(ctx, issueId)) continue;

    if (terminalIssueIds.has(issueId)) {
      if (opts.fix) {
        let removed = false;
        let errMsg = "";
        try {
          rmSync(wtPath, { recursive: true, force: true });
          removed = true;
        } catch (err) {
          errMsg = err instanceof Error ? err.message : String(err);
        }
        writeAuditEntry(opts.auditLogPath, {
          ts: new Date().toISOString(),
          action: "dangling_worktree",
          issueId,
          worktreePath: wtPath,
          result: removed ? "removed" : "failed",
          ...(removed ? {} : { error: errMsg }),
        });
        checks.push({
          name: "dangling_worktree",
          status: removed ? "ok" : "fail",
          message: removed
            ? `Removed dangling worktree ${wtPath} for terminal issue ${issueId}`
            : `Failed to remove dangling worktree ${wtPath} for issue ${issueId}: ${errMsg}`,
          issueId,
          worktreePath: wtPath,
        });
      } else {
        checks.push({
          name: "dangling_worktree",
          status: "warn",
          message: `Worktree at ${wtPath} belongs to terminal issue ${issueId} but still exists on disk`,
          issueId,
          worktreePath: wtPath,
        });
      }
    }
  }
}

function writeAuditEntry(auditPath: string, entry: Record<string, unknown>) {
  try {
    mkdirSync(dirname(auditPath), { recursive: true });
    appendFileSync(auditPath, `${JSON.stringify(entry)}\n`);
  } catch {
    // best-effort: never fail the doctor command due to audit write
  }
}

function appendPhaseStaleChecks(
  ctx: ScanContext,
  now: Date,
  thresholds: Partial<Record<GxpmPhase, number>>,
  checks: DoctorIssuesCheck[],
) {
  const issuesDir = join(ctx.root, ".gxpm", "issues");
  if (!existsSync(issuesDir)) return;

  for (const name of readdirSync(issuesDir)) {
    if (!isAllowed(ctx, name)) continue;
    const statePath = join(issuesDir, name, "state.json");
    if (!existsSync(statePath)) continue;

    let state: IssueState;
    try {
      state = JSON.parse(readFileSync(statePath, "utf8")) as IssueState;
    } catch {
      continue;
    }

    const phase = state.currentPhase as GxpmPhase | undefined;
    if (!phase) continue;
    const threshold = thresholds[phase];
    if (typeof threshold !== "number") continue;

    const enteredAt = currentPhaseEnteredAt(state);
    if (!enteredAt) continue;

    const elapsedMs = now.getTime() - new Date(enteredAt).getTime();
    if (elapsedMs <= 0) continue;
    const elapsedDays = Math.floor(elapsedMs / (24 * 60 * 60 * 1000));
    if (elapsedDays < threshold) continue;

    checks.push({
      name: "phase_stale",
      status: "warn",
      message: `Issue ${state.issueId} has been in phase ${phase} for ${elapsedDays} days (threshold ${threshold} days)`,
      issueId: state.issueId,
    });
  }
}

function appendMissingArtifactChecks(ctx: ScanContext, checks: DoctorIssuesCheck[]) {
  const issuesDir = join(ctx.root, ".gxpm", "issues");
  if (!existsSync(issuesDir)) return;

  for (const name of readdirSync(issuesDir)) {
    if (!isAllowed(ctx, name)) continue;
    const statePath = join(issuesDir, name, "state.json");
    if (!existsSync(statePath)) continue;

    let state: IssueState;
    try {
      state = JSON.parse(readFileSync(statePath, "utf8")) as IssueState;
    } catch {
      continue;
    }

    const phase = state.currentPhase;
    if (!phase) continue;

    // Look up the artifact required to transition out of the current phase.
    const rule = PHASE_GATE_RULES.find((r) => r.fromPhase === phase);
    if (!rule) continue;

    const artifactPath = join(issuesDir, name, "artifacts", `${rule.requiredArtifact}.json`);
    if (existsSync(artifactPath)) continue;

    checks.push({
      name: "missing_artifact",
      status: "warn",
      message: `Issue ${state.issueId} is in phase ${phase} but the ${rule.requiredArtifact} artifact is missing`,
      issueId: state.issueId,
    });
  }
}

function appendHandoffBrokenChecks(ctx: ScanContext, checks: DoctorIssuesCheck[]) {
  const issuesDir = join(ctx.root, ".gxpm", "issues");
  if (!existsSync(issuesDir)) return;

  for (const name of readdirSync(issuesDir)) {
    if (!isAllowed(ctx, name)) continue;
    const statePath = join(issuesDir, name, "state.json");
    const handoffPath = join(issuesDir, name, "artifacts", "phase-handoff.json");
    if (!existsSync(statePath) || !existsSync(handoffPath)) continue;

    let state: IssueState;
    let handoff: { payload?: Record<string, unknown> };
    try {
      state = JSON.parse(readFileSync(statePath, "utf8")) as IssueState;
      handoff = JSON.parse(readFileSync(handoffPath, "utf8"));
    } catch {
      continue;
    }

    const payload = handoff.payload ?? {};
    const fromPhase = typeof payload.fromPhase === "string" ? payload.fromPhase : undefined;
    const nextPhase = typeof payload.nextPhase === "string" ? payload.nextPhase : undefined;
    const acknowledgedAt =
      typeof payload.acknowledgedAt === "string" ? payload.acknowledgedAt : null;

    if (!fromPhase || !nextPhase) continue;
    if (acknowledgedAt) continue;

    const nextPhaseEntered = (state.phaseHistory ?? []).some((h) => h.phase === nextPhase);
    if (!nextPhaseEntered) continue;

    checks.push({
      name: "handoff_broken",
      status: "warn",
      message: `Issue ${state.issueId} entered phase ${nextPhase} from ${fromPhase} but the phase-handoff artifact was never acknowledged`,
      issueId: state.issueId,
    });
  }
}

function currentPhaseEnteredAt(state: IssueState): string | undefined {
  const history = state.phaseHistory ?? [];
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].phase === state.currentPhase) {
      return history[i].enteredAt;
    }
  }
  return undefined;
}

export function formatDoctorIssuesReport(report: DoctorIssuesReport): string {
  const lines: string[] = [];
  lines.push(`gxpm doctor issues — schema v${report.schema_version}`);
  lines.push(`status: ${report.status}  health_score: ${report.health_score}/100`);
  lines.push("");
  if (report.checks.length === 0) {
    lines.push("no business-state issues detected");
    return lines.join("\n");
  }
  for (const c of report.checks) {
    const tag = c.status === "ok" ? "[ OK ]" : c.status === "warn" ? "[WARN]" : "[FAIL]";
    lines.push(`${tag} ${c.name}: ${c.message}`);
  }
  return lines.join("\n");
}
