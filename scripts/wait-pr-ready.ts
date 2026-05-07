#!/usr/bin/env bun

type GateState = "ready" | "pending" | "blocked";

export interface WaitPrReadyOptions {
  pr: string;
  repo?: string;
  intervalSec: number;
  timeoutSec: number;
  allowReviewRequired: boolean;
  once: boolean;
  json: boolean;
}

export interface NormalizedCheck {
  name: string;
  status: string;
  conclusion: string;
}

export interface GateClassification {
  state: GateState;
  reason: string;
  headRefOid?: string;
  mergeStateStatus?: string;
  mergeable?: string;
  reviewDecision?: string;
  pendingChecks: string[];
  failedChecks: string[];
}

const SUCCESS_STATES = new Set(["SUCCESS", "SKIPPED", "NEUTRAL"]);
const COMPLETED_STATES = new Set(["COMPLETED", "SUCCESS", "SKIPPED", "NEUTRAL"]);
const FAILURE_STATES = new Set([
  "ACTION_REQUIRED",
  "CANCELLED",
  "ERROR",
  "FAILURE",
  "FAILED",
  "STARTUP_FAILURE",
  "STALE",
  "TIMED_OUT",
]);

export function parseWaitPrReadyArgs(argv: string[]): WaitPrReadyOptions {
  const options: WaitPrReadyOptions = {
    pr: "",
    intervalSec: 60,
    timeoutSec: 900,
    allowReviewRequired: false,
    once: false,
    json: false,
  };

  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      throw new UsageError(usage(), 0);
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--once") {
      options.once = true;
      continue;
    }
    if (arg === "--allow-review-required") {
      options.allowReviewRequired = true;
      continue;
    }
    if (arg === "--repo") {
      options.repo = requiredValue(argv, ++i, arg);
      continue;
    }
    if (arg === "--interval-sec") {
      options.intervalSec = positiveInteger(requiredValue(argv, ++i, arg), arg);
      continue;
    }
    if (arg === "--timeout-sec") {
      options.timeoutSec = positiveInteger(requiredValue(argv, ++i, arg), arg);
      continue;
    }
    if (arg.startsWith("--")) {
      throw new UsageError(`Unknown option: ${arg}\n\n${usage()}`, 2);
    }
    positional.push(arg);
  }

  if (positional.length !== 1) {
    throw new UsageError(`Expected exactly one PR number, URL, or branch.\n\n${usage()}`, 2);
  }
  options.pr = positional[0];
  return options;
}

export function classifyPrGate(
  prView: unknown,
  options: Pick<WaitPrReadyOptions, "allowReviewRequired"> = { allowReviewRequired: false },
): GateClassification {
  const record = asRecord(prView);
  const mergeStateStatus = upperString(record.mergeStateStatus);
  const mergeable = upperString(record.mergeable);
  const reviewDecision = upperString(record.reviewDecision);
  const headRefOid = stringValue(record.headRefOid);
  const checks = normalizeStatusCheckRollup(record.statusCheckRollup);

  const failedChecks = checks.filter(isFailedCheck).map((check) => check.name);
  if (failedChecks.length > 0) {
    return classification("blocked", "one or more status checks failed", {
      headRefOid,
      mergeStateStatus,
      mergeable,
      reviewDecision,
      checks,
      failedChecks,
    });
  }

  if (mergeable === "CONFLICTING" || mergeStateStatus === "DIRTY") {
    return classification("blocked", "PR has merge conflicts or dirty merge state", {
      headRefOid,
      mergeStateStatus,
      mergeable,
      reviewDecision,
      checks,
    });
  }

  if (reviewDecision === "CHANGES_REQUESTED") {
    return classification("blocked", "review changes were requested", {
      headRefOid,
      mergeStateStatus,
      mergeable,
      reviewDecision,
      checks,
    });
  }

  const pendingChecks = checks.filter((check) => !isPassedCheck(check)).map((check) => check.name);
  if (pendingChecks.length > 0) {
    return classification("pending", "waiting for status checks", {
      headRefOid,
      mergeStateStatus,
      mergeable,
      reviewDecision,
      checks,
      pendingChecks,
    });
  }

  if (!options.allowReviewRequired && reviewDecision !== "APPROVED") {
    return classification("pending", "waiting for approving review decision", {
      headRefOid,
      mergeStateStatus,
      mergeable,
      reviewDecision,
      checks,
    });
  }

  const mergeStateReady = mergeStateStatus === "CLEAN" || (!mergeStateStatus && mergeable === "MERGEABLE");
  if (!mergeStateReady) {
    return classification("pending", "waiting for clean merge state", {
      headRefOid,
      mergeStateStatus,
      mergeable,
      reviewDecision,
      checks,
    });
  }

  return classification("ready", "review, checks, and merge state are ready", {
    headRefOid,
    mergeStateStatus,
    mergeable,
    reviewDecision,
    checks,
  });
}

export function normalizeStatusCheckRollup(value: unknown): NormalizedCheck[] {
  if (!Array.isArray(value)) return [];
  return value.map((item, index) => {
    const record = asRecord(item);
    const name =
      stringValue(record.name) ||
      stringValue(record.workflowName) ||
      stringValue(record.context) ||
      `check-${index + 1}`;
    const status = upperString(record.status) || upperString(record.state);
    const conclusion = upperString(record.conclusion);
    return { name, status, conclusion };
  });
}

function classification(
  state: GateState,
  reason: string,
  input: {
    headRefOid?: string;
    mergeStateStatus?: string;
    mergeable?: string;
    reviewDecision?: string;
    checks: NormalizedCheck[];
    pendingChecks?: string[];
    failedChecks?: string[];
  },
): GateClassification {
  return {
    state,
    reason,
    headRefOid: input.headRefOid,
    mergeStateStatus: input.mergeStateStatus,
    mergeable: input.mergeable,
    reviewDecision: input.reviewDecision,
    pendingChecks: input.pendingChecks ?? [],
    failedChecks: input.failedChecks ?? [],
  };
}

function isPassedCheck(check: NormalizedCheck): boolean {
  if (FAILURE_STATES.has(check.conclusion) || FAILURE_STATES.has(check.status)) return false;
  if (SUCCESS_STATES.has(check.conclusion) || SUCCESS_STATES.has(check.status)) return true;
  if (COMPLETED_STATES.has(check.status)) return SUCCESS_STATES.has(check.conclusion);
  return false;
}

function isFailedCheck(check: NormalizedCheck): boolean {
  return FAILURE_STATES.has(check.conclusion) || FAILURE_STATES.has(check.status);
}

async function main() {
  let options: WaitPrReadyOptions;
  try {
    options = parseWaitPrReadyArgs(process.argv.slice(2));
  } catch (error) {
    if (error instanceof UsageError) {
      console.log(error.message);
      process.exit(error.exitCode);
    }
    throw error;
  }

  const startedAt = Date.now();
  const deadline = startedAt + options.timeoutSec * 1000;
  let lastError = "";

  while (true) {
    const result = fetchPrView(options);
    if (!result.ok) {
      lastError = result.error;
      emit(options, {
        state: "pending",
        reason: "gh pr view failed; retrying until timeout",
        error: result.error,
        elapsedSec: elapsedSec(startedAt),
      });
      if (options.once) process.exit(2);
    } else {
      const gate = classifyPrGate(result.prView, options);
      emit(options, { ...gate, elapsedSec: elapsedSec(startedAt) });
      if (gate.state === "ready") process.exit(0);
      if (gate.state === "blocked") process.exit(1);
      lastError = "";
      if (options.once) process.exit(124);
    }

    if (Date.now() >= deadline) {
      emit(options, {
        state: "pending",
        reason: "timeout waiting for PR gate readiness",
        error: lastError || undefined,
        elapsedSec: elapsedSec(startedAt),
      });
      process.exit(124);
    }

    await sleep(Math.min(options.intervalSec * 1000, Math.max(0, deadline - Date.now())));
  }
}

function fetchPrView(options: WaitPrReadyOptions): { ok: true; prView: unknown } | { ok: false; error: string } {
  const cmd = [
    "gh",
    "pr",
    "view",
    options.pr,
    "--json",
    "headRefOid,mergeStateStatus,mergeable,reviewDecision,statusCheckRollup",
  ];
  if (options.repo) {
    cmd.push("--repo", options.repo);
  }

  const result = Bun.spawnSync({
    cmd,
    stdout: "pipe",
    stderr: "pipe",
  });

  if (result.exitCode !== 0) {
    return { ok: false, error: result.stderr.toString().trim() || `gh exited with ${result.exitCode}` };
  }

  try {
    return { ok: true, prView: JSON.parse(result.stdout.toString()) };
  } catch (error) {
    return {
      ok: false,
      error: `failed to parse gh output: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function emit(options: WaitPrReadyOptions, payload: Record<string, unknown>) {
  if (options.json) {
    console.log(JSON.stringify(payload));
    return;
  }
  const details = [
    `state=${payload.state}`,
    `reason=${payload.reason}`,
    payload.headRefOid ? `head=${String(payload.headRefOid).slice(0, 12)}` : "",
    payload.mergeStateStatus ? `mergeState=${payload.mergeStateStatus}` : "",
    payload.reviewDecision ? `review=${payload.reviewDecision}` : "",
    payload.elapsedSec !== undefined ? `elapsed=${payload.elapsedSec}s` : "",
  ].filter(Boolean);
  console.log(details.join(" "));
  if (Array.isArray(payload.pendingChecks) && payload.pendingChecks.length > 0) {
    console.log(`pendingChecks=${payload.pendingChecks.join(",")}`);
  }
  if (Array.isArray(payload.failedChecks) && payload.failedChecks.length > 0) {
    console.log(`failedChecks=${payload.failedChecks.join(",")}`);
  }
  if (payload.error) {
    console.log(`error=${payload.error}`);
  }
}

function usage() {
  return `Usage: bun run scripts/wait-pr-ready.ts <pr-number-or-url> [options]

Poll GitHub PR readiness with a finite timeout. Intended for in-turn gxpm
ship/pr-check waits such as CodeRabbit and GitHub checks.

Options:
  --repo <owner/repo>          Repository for gh pr view
  --interval-sec <seconds>    Poll interval (default: 60)
  --timeout-sec <seconds>     Maximum wait (default: 900)
  --allow-review-required     Do not require reviewDecision=APPROVED
  --once                      Check once and exit
  --json                      Emit JSON lines

Exit codes:
  0    ready
  1    blocked by failure, conflict, or requested changes
  2    usage or command error in --once mode
  124  timeout or still pending in --once mode`;
}

function requiredValue(argv: string[], index: number, option: string): string {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new UsageError(`${option} requires a value\n\n${usage()}`, 2);
  }
  return value;
}

function positiveInteger(raw: string, option: string): number {
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 1 || String(value) !== raw) {
    throw new UsageError(`${option} requires a positive integer`, 2);
  }
  return value;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function upperString(value: unknown): string {
  return stringValue(value)?.toUpperCase() ?? "";
}

function elapsedSec(startedAt: number): number {
  return Math.floor((Date.now() - startedAt) / 1000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class UsageError extends Error {
  constructor(message: string, readonly exitCode: number) {
    super(message);
  }
}

if (import.meta.main) {
  await main();
}
