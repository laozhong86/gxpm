import { resolve } from "node:path";
import { PHASE_GATE_RULES } from "../../core/phase-gates";
import { createIssueState, transitionIssuePhase, type GxpmPhase } from "../../core/state";
import { PHASE_ARTIFACT_COMMANDS } from "../../scripts/phase-artifact-commands";

const cliPath = resolve(import.meta.dir, "..", "..", "scripts", "gxpm.ts");

type CliResult = ReturnType<typeof runCli>;

export function runCli(root: string, args: string[]) {
  return runScript([cliPath, ...args], root);
}

export function runCliWithInput(root: string, args: string[], stdin: string) {
  return Bun.spawnSync({
    cmd: ["bun", "run", cliPath, ...args],
    cwd: root,
    stdin: new TextEncoder().encode(stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
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
}> = PHASE_GATE_RULES.map((rule, index) => ({
  initialize: PHASE_ARTIFACT_COMMANDS[index].initialize,
  nextPhase: rule.nextPhase,
}));

const CLI_WORKFLOW_STEPS: Array<{
  initializeArgs: string[];
  nextPhase: GxpmPhase;
}> = PHASE_GATE_RULES.map((rule) => ({
  initializeArgs: rule.command.replace(/^gxpm\s+/, "").replace(/\s+<issue-id>$/, "").split(" "),
  nextPhase: rule.nextPhase,
}));

export const WORKFLOW_HELPER_PHASES = WORKFLOW_STEPS.map((step) => step.nextPhase);
export const WORKFLOW_HELPER_CLI_COMMANDS = CLI_WORKFLOW_STEPS.map((step) =>
  `gxpm ${step.initializeArgs.join(" ")} <issue-id>`,
);
