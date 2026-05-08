/**
 * Workflow CLI — gxpm workflow subcommand.
 *
 * Lists, runs, checks status, and resumes YAML-defined workflows.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { WorkflowEngine } from "../../core/workflows/engine";

const WORKFLOWS_DIR = ".gxpm/workflows";
const RUNS_DIR = join(WORKFLOWS_DIR, "runs");

export function runWorkflowCommand(argv: string[]) {
  const subcommand = argv[1];

  if (subcommand === "list") {
    return listWorkflows();
  }

  if (subcommand === "run") {
    const workflowId = argv[2];
    const issueId = argv.find((a) => a.startsWith("--issue="))?.slice(8);
    if (!workflowId) {
      throw new Error("Usage: gxpm workflow run <workflow-id> --issue=<id>");
    }
    return runWorkflow(workflowId, issueId);
  }

  if (subcommand === "status") {
    const runId = argv[2];
    if (!runId) {
      throw new Error("Usage: gxpm workflow status <run-id>");
    }
    return workflowStatus(runId);
  }

  if (subcommand === "resume") {
    const runId = argv[2];
    if (!runId) {
      throw new Error("Usage: gxpm workflow resume <run-id>");
    }
    return resumeWorkflow(runId);
  }

  console.log("Usage: gxpm workflow <list|run|status|resume>");
}

function listWorkflows() {
  const dir = resolve(WORKFLOWS_DIR);
  if (!existsSync(dir)) {
    console.log("No workflows directory found.");
    return;
  }

  const files = Array.from(Bun.file(dir).stream ? [] : []); // placeholder
  // Simple directory listing
  try {
    const entries = Array.from(new Bun.Glob("*.yml").scanSync(dir));
    if (entries.length === 0) {
      console.log("No workflow definitions found.");
      return;
    }
    console.log("Workflows:");
    for (const entry of entries) {
      console.log(`  - ${entry}`);
    }
  } catch {
    console.log("No workflow definitions found.");
  }
}

function runWorkflow(workflowId: string, issueId?: string) {
  const yamlPath = join(WORKFLOWS_DIR, `${workflowId}.yml`);
  if (!existsSync(yamlPath)) {
    throw new Error(`Workflow not found: ${workflowId}`);
  }

  const engine = new WorkflowEngine(process.cwd());
  const def = engine.loadYaml(yamlPath);

  const inputs: Record<string, unknown> = {};
  if (issueId) inputs.issue_id = issueId;

  const state = engine.createRun(def.id, inputs);

  // Persist run state
  const runDir = join(RUNS_DIR, state.runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "state.json"), JSON.stringify(state, null, 2));

  console.log(`Workflow run started: ${state.runId}`);
  console.log(`Workflow: ${def.name ?? def.id}`);
  console.log(`Status: ${state.status}`);

  // Execute
  engine.run(state).then((result) => {
    writeFileSync(join(runDir, "state.json"), JSON.stringify(result, null, 2));
    console.log(`Workflow ${result.status}: ${result.runId}`);
  });
}

function workflowStatus(runId: string) {
  const statePath = join(RUNS_DIR, runId, "state.json");
  if (!existsSync(statePath)) {
    throw new Error(`Run not found: ${runId}`);
  }
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  console.log(`Run: ${state.runId}`);
  console.log(`Workflow: ${state.workflowId}`);
  console.log(`Status: ${state.status}`);
  console.log(`Current step: ${state.currentStepIndex}`);
}

function resumeWorkflow(runId: string) {
  const statePath = join(RUNS_DIR, runId, "state.json");
  if (!existsSync(statePath)) {
    throw new Error(`Run not found: ${runId}`);
  }
  const state = JSON.parse(readFileSync(statePath, "utf8"));

  const engine = new WorkflowEngine(process.cwd());
  // Reload workflow definition
  const yamlPath = join(WORKFLOWS_DIR, `${state.workflowId}.yml`);
  if (existsSync(yamlPath)) {
    engine.loadYaml(yamlPath);
  }

  engine.resume(state).then((result) => {
    writeFileSync(statePath, JSON.stringify(result, null, 2));
    console.log(`Workflow resumed and ${result.status}: ${result.runId}`);
  });
}
