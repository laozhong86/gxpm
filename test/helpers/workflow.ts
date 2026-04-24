import { resolve } from "node:path";
import { initializeAcceptanceCheck } from "../../core/ac-check";
import { initializeDispatch } from "../../core/dispatch";
import { initializeLocalVerify } from "../../core/implement";
import { initializeLandFindings } from "../../core/land";
import { initializePlan } from "../../core/plan";
import { initializePrCheck } from "../../core/pr-check";
import { initializeQaFindings } from "../../core/qa";
import { initializeSelfReview } from "../../core/self-review";
import { initializeShipReadiness } from "../../core/ship";
import { createIssueState, transitionIssuePhase, type GxpmPhase } from "../../core/state";
import { initializeTriage } from "../../core/triage";
import { initializeVerifyFindings } from "../../core/verify";

const cliPath = resolve(import.meta.dir, "..", "..", "scripts", "gxpm.ts");

type CliResult = ReturnType<typeof runCli>;

export function runCli(root: string, args: string[]) {
  return runScript([cliPath, ...args], root);
}

export function runScript(args: string[], cwd = process.cwd()) {
  return Bun.spawnSync({
    cmd: ["bun", "run", ...args],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
}

export function output(result: CliResult) {
  return `${result.stdout.toString()}${result.stderr.toString()}`;
}

export function enterPhase(root: string, issueId: string, targetPhase: GxpmPhase) {
  createIssueState({ root, issueId });
  if (targetPhase === "triage") {
    return;
  }

  for (const step of WORKFLOW_STEPS) {
    step.initialize({ root, issueId });
    transitionIssuePhase({ root, issueId, nextPhase: step.nextPhase });
    if (step.nextPhase === targetPhase) {
      return;
    }
  }

  throw new Error(`Unsupported target phase: ${targetPhase}`);
}

export function enterPhaseCli(root: string, issueId: string, targetPhase: GxpmPhase) {
  runRequiredCli(root, ["issue", "create", issueId]);
  if (targetPhase === "triage") {
    return;
  }

  for (const step of CLI_WORKFLOW_STEPS) {
    runRequiredCli(root, [...step.initializeArgs, issueId]);
    runRequiredCli(root, ["issue", "transition", issueId, step.nextPhase]);
    if (step.nextPhase === targetPhase) {
      return;
    }
  }

  throw new Error(`Unsupported target phase: ${targetPhase}`);
}

function runRequiredCli(root: string, args: string[]) {
  const result = runCli(root, args);
  if (result.exitCode !== 0) {
    throw new Error(`CLI command failed: ${args.join(" ")}\n${output(result)}`);
  }
}

const WORKFLOW_STEPS: Array<{
  initialize: (input: { root: string; issueId: string }) => unknown;
  nextPhase: GxpmPhase;
}> = [
  { initialize: initializeTriage, nextPhase: "plan" },
  { initialize: initializePlan, nextPhase: "dispatch" },
  { initialize: initializeDispatch, nextPhase: "implement" },
  { initialize: initializeLocalVerify, nextPhase: "local-verify" },
  { initialize: initializeAcceptanceCheck, nextPhase: "ac-check" },
  { initialize: initializeSelfReview, nextPhase: "self-review" },
  { initialize: initializeShipReadiness, nextPhase: "ship" },
  { initialize: initializePrCheck, nextPhase: "pr-check" },
  { initialize: initializeVerifyFindings, nextPhase: "verify" },
  { initialize: initializeQaFindings, nextPhase: "qa" },
  { initialize: initializeLandFindings, nextPhase: "land" },
];

const CLI_WORKFLOW_STEPS: Array<{
  initializeArgs: string[];
  nextPhase: GxpmPhase;
}> = [
  { initializeArgs: ["triage", "init"], nextPhase: "plan" },
  { initializeArgs: ["plan", "init"], nextPhase: "dispatch" },
  { initializeArgs: ["dispatch", "init"], nextPhase: "implement" },
  { initializeArgs: ["implement", "verify"], nextPhase: "local-verify" },
  { initializeArgs: ["local-verify", "ac-check"], nextPhase: "ac-check" },
  { initializeArgs: ["ac-check", "self-review"], nextPhase: "self-review" },
  { initializeArgs: ["self-review", "ship"], nextPhase: "ship" },
  { initializeArgs: ["ship", "pr-check"], nextPhase: "pr-check" },
  { initializeArgs: ["pr-check", "verify"], nextPhase: "verify" },
  { initializeArgs: ["verify", "qa"], nextPhase: "qa" },
  { initializeArgs: ["qa", "land"], nextPhase: "land" },
];
