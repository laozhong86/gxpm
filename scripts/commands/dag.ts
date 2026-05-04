import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseWorkflow } from "../../core/dag-loader";
import { executeDag } from "../../core/dag-executor";
import type { DagNode, NodeOutput } from "../../core/dag-schemas";

export function runDagCommand(argv: string[]) {
  const subcommand = argv[1];
  const filePath = argv[2];

  if (!subcommand) {
    console.log("Usage: gxpm dag <validate|run> <workflow-file>");
    return;
  }

  if (subcommand === "validate") {
    if (!filePath) {
      throw new Error("Usage: gxpm dag validate <workflow-file>");
    }
    const fullPath = resolve(filePath);
    const content = readFileSync(fullPath, "utf8");
    const raw = JSON.parse(content);
    const result = parseWorkflow(raw, filePath);

    if (result.error) {
      console.error(`Validation failed: ${result.error.error}`);
      process.exit(1);
    } else {
      console.log(`Workflow '${result.workflow!.name}' is valid.`);
      console.log(`Nodes: ${result.workflow!.nodes.length}`);
      for (const node of result.workflow!.nodes) {
        const deps = node.depends_on?.length ? ` (depends_on: ${node.depends_on.join(", ")})` : "";
        console.log(`  - ${node.id}: ${node.type}${deps}`);
      }
    }
    return;
  }

  if (subcommand === "run") {
    if (!filePath) {
      throw new Error("Usage: gxpm dag run <workflow-file>");
    }
    const fullPath = resolve(filePath);
    const content = readFileSync(fullPath, "utf8");
    const raw = JSON.parse(content);
    const result = parseWorkflow(raw, filePath);

    if (result.error) {
      throw new Error(`Validation failed: ${result.error.error}`);
    }

    const workflow = result.workflow!;
    const startTime = Date.now();

    // Simple echo executor for CLI demo
    const executor = async (node: DagNode): Promise<NodeOutput> => {
      console.log(`[${node.id}] Running ${node.type} node...`);
      if ("bash" in node && node.bash) {
        const proc = Bun.spawn(["bash", "-c", node.bash], {
          cwd: process.cwd(),
          stdout: "pipe",
          stderr: "pipe",
        });
        const stdout = await new Response(proc.stdout).text();
        const stderr = await new Response(proc.stderr).text();
        const exitCode = proc.exitCode ?? 1;
        if (exitCode !== 0) {
          return { state: "failed", output: stdout, error: stderr || `exit code ${exitCode}` };
        }
        return { state: "completed", output: stdout.trim() };
      }
      if ("script" in node && node.script) {
        const proc = Bun.spawn(["bash", node.script], {
          cwd: process.cwd(),
          stdout: "pipe",
          stderr: "pipe",
        });
        const stdout = await new Response(proc.stdout).text();
        const stderr = await new Response(proc.stderr).text();
        const exitCode = proc.exitCode ?? 1;
        if (exitCode !== 0) {
          return { state: "failed", output: stdout, error: stderr || `exit code ${exitCode}` };
        }
        return { state: "completed", output: stdout.trim() };
      }
      if ("prompt" in node && node.prompt) {
        return { state: "completed", output: node.prompt };
      }
      if ("phase" in node && node.phase) {
        return { state: "completed", output: node.phase };
      }
      if (node.type === "approval") {
        return { state: "completed", output: "approved" };
      }
      if (node.type === "cancel") {
        return { state: "completed", output: "cancelled" };
      }
      return { state: "completed", output: "" };
    };

    executeDag(workflow.nodes, executor, {
      workflowName: workflow.name,
      onNodeStart: (id) => console.log(`[${id}] START`),
      onNodeComplete: (id, output) =>
        console.log(`[${id}] ${output.state.toUpperCase()}${output.error ? `: ${output.error}` : ""}`),
    })
      .then((result) => {
        const duration = Date.now() - startTime;
        console.log(`\nWorkflow ${result.success ? "succeeded" : "failed"} in ${duration}ms`);
        if (!result.success && result.error) {
          console.error(`Error: ${result.error}`);
        }
        for (const [id, output] of result.nodeOutputs) {
          console.log(`  ${id}: ${output.state}${output.output ? ` → ${output.output.slice(0, 80)}` : ""}`);
        }
        process.exit(result.success ? 0 : 1);
      })
      .catch((err) => {
        console.error(`Execution error: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      });
    return;
  }

  throw new Error(`Unknown dag subcommand: ${subcommand}`);
}
