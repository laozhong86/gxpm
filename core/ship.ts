import { existsSync } from "node:fs";
import { join } from "node:path";
import { writeArtifact } from "./artifacts";
import { readIssueState } from "./state";
import { AgentRegistry } from "./agent-runtime";

export function initializeShipReadiness(input: { root?: string; issueId: string; army?: boolean }) {
  const root = input.root ?? process.cwd();
  const state = readIssueState({ root, issueId: input.issueId });
  if (state.currentPhase !== "cleanup" && state.currentPhase !== "self-review") {
    throw new Error(`Ship readiness can only be initialized from cleanup or self-review phase: current phase is ${state.currentPhase}`);
  }

  const result = writeArtifact({
    root,
    issueId: input.issueId,
    type: "ship-readiness",
    payload: {
      checklist: [],
      compatibilityMigration: {
        backwardCompatible: true,
        configChanges: false,
        migrationSteps: "",
      },
      blastRadius: {
        affectedSubsystems: [],
        guardrails: "",
        unintendedEffects: "",
      },
      humanVerification: {
        edgeCases: "",
        notVerified: "",
        verifiedScenarios: "",
      },
      releaseNotes: "",
      reviewedArtifacts: ["self-review", "acceptance-check"],
      risks: [],
      risksAndMitigations: [],
      rollbackPlan: {
        failureSymptoms: "",
        featureFlags: "",
        rollbackCommand: "",
      },
      securityImpact: {
        fileSystemAccessChanged: false,
        networkCallsChanged: false,
        newPermissionsOrCapabilities: false,
        riskAndMitigation: "",
        secretsHandlingChanged: false,
      },
      status: "draft",
      summary: "",
      targetBranch: "",
    },
  });

  // When army mode is enabled, also initialize the ship-audit-report artifact
  if (input.army) {
    const registry = new AgentRegistry();
    const discoverRoot = existsSync(join(root, "agents")) ? root : process.cwd();
    registry.discover(discoverRoot);
    const agents = registry.listByArmy("ship-audit-army");

    if (agents.length === 0) {
      console.warn("warning: --army flag set but no ship-audit-army agents found");
    } else {
      writeArtifact({
        root,
        issueId: input.issueId,
        type: "ship-audit-report",
        payload: {
          army: "ship-audit-army",
          phase: "ship",
          issueId: input.issueId,
          generatedAt: new Date().toISOString(),
          findings: [],
          summary: `${agents.length} audit role(s) queued for execution: ${agents.map((a) => a.name).join(", ")}`,
          status: "draft",
          agents: agents.map((a) => ({ name: a.name, role: a.role, description: a.description })),
        },
      });
    }
  }

  return result;
}
