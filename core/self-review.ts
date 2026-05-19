import { existsSync } from "node:fs";
import { join } from "node:path";
import { writeArtifact } from "./artifacts";
import { lintCodexPlans } from "./plan-lint";
import { readIssueState } from "./state";
import { AgentRegistry } from "./agent-runtime";

export function initializeSelfReview(input: { root?: string; issueId: string; army?: boolean }) {
  const root = input.root ?? process.cwd();
  const state = readIssueState({ root, issueId: input.issueId });
  if (state.currentPhase !== "ac-check") {
    throw new Error(`Self review can only be initialized from ac-check phase: current phase is ${state.currentPhase}`);
  }

  const result = writeArtifact({
    root,
    issueId: input.issueId,
    type: "self-review",
    payload: {
      findings: [],
      reviewedArtifacts: ["acceptance-check", "local-verify"],
      risks: [],
      status: "draft",
      summary: "",
      plan_lint_findings: lintCodexPlans(root, input.issueId),
    },
  });

  // When army mode is enabled, also initialize the review-report artifact
  if (input.army) {
    const registry = new AgentRegistry();
    // Discover from the project root (where agents/ directory lives)
    // Fallback to process.cwd() if root doesn't contain agents/
    const discoverRoot = existsSync(join(root, "agents")) ? root : process.cwd();
    registry.discover(discoverRoot);
    const agents = registry.listByArmy("review-army");

    if (agents.length === 0) {
      console.warn("warning: --army flag set but no review-army agents found");
    } else {
      // Write an initial review-report with empty findings
      // The actual execution happens via the host's subagent mechanism
      writeArtifact({
        root,
        issueId: input.issueId,
        type: "review-report",
        payload: {
          army: "review-army",
          phase: "self-review",
          issueId: input.issueId,
          generatedAt: new Date().toISOString(),
          findings: [],
          summary: `${agents.length} review role(s) queued for execution: ${agents.map((a) => a.name).join(", ")}`,
          status: "draft",
          agents: agents.map((a) => ({ name: a.name, role: a.role, description: a.description })),
        },
      });
    }
  }

  return result;
}
