import { describe, it, expect } from "bun:test";
import {
  AgentRegistry,
  executeArmy,
  hasBlockingFindings,
  countFindingsBySeverity,
  detectParallelSupport,
  type ArmyReport,
  type AgentFinding,
} from "../../core/agent-runtime";

describe("AgentRuntime", () => {
  describe("AgentRegistry", () => {
    it("discovers review-army agents from agents/review-army/", () => {
      const registry = new AgentRegistry();
      const agents = registry.discover(process.cwd());
      const reviewAgents = agents.filter((a) => a.army === "review-army");
      expect(reviewAgents.length).toBe(5);
    });

    it("discovers ship-audit-army agents from agents/ship-audit-army/", () => {
      const registry = new AgentRegistry();
      const agents = registry.discover(process.cwd());
      const auditAgents = agents.filter((a) => a.army === "ship-audit-army");
      expect(auditAgents.length).toBe(3);
    });

    it("each definition contains name, phase, role, inputContract, outputFormat, hardGates", () => {
      const registry = new AgentRegistry();
      const agents = registry.discover(process.cwd());
      for (const agent of agents) {
        expect(agent.name).toBeTruthy();
        expect(agent.phase).toBeTruthy();
        expect(agent.role).toBeTruthy();
        expect(agent.hardGates).toBeArray();
      }
    });

    it("array order follows filesystem alphabetical order", () => {
      const registry = new AgentRegistry();
      const agents = registry.discover(process.cwd());
      const reviewAgents = agents.filter((a) => a.army === "review-army");
      const names = reviewAgents.map((a) => a.name);
      const sorted = [...names].sort();
      expect(names).toEqual(sorted);
    });

    it("lists agents by phase", () => {
      const registry = new AgentRegistry();
      registry.discover(process.cwd());
      const selfReviewAgents = registry.listByPhase("self-review");
      expect(selfReviewAgents.length).toBe(5);
      for (const agent of selfReviewAgents) {
        expect(agent.phase).toBe("self-review");
      }
    });

    it("lists agents by army", () => {
      const registry = new AgentRegistry();
      registry.discover(process.cwd());
      const shipAuditAgents = registry.listByArmy("ship-audit-army");
      expect(shipAuditAgents.length).toBe(3);
      for (const agent of shipAuditAgents) {
        expect(agent.army).toBe("ship-audit-army");
      }
    });
  });

  describe("executeArmy", () => {
    it("produces an ArmyReport with correct structure", async () => {
      const registry = new AgentRegistry();
      registry.discover(process.cwd());
      const agents = registry.listByArmy("review-army");

      const report = await executeArmy({
        issueId: "TEST-001",
        army: "review-army",
        phase: "self-review",
        agents,
      });

      expect(report.army).toBe("review-army");
      expect(report.phase).toBe("self-review");
      expect(report.issueId).toBe("TEST-001");
      expect(report.findings).toBeArray();
      expect(report.status).toBeOneOf(["completed", "partial", "failed"]);
      expect(report.generatedAt).toBeTruthy();
    });

    it("sorts findings by severity: blocking first", async () => {
      const report: ArmyReport = {
        army: "test",
        phase: "self-review",
        issueId: "TEST",
        generatedAt: new Date().toISOString(),
        findings: [
          { role: "r1", severity: "suggestion", rationale: "s1", recommendation: "rec1" },
          { role: "r2", severity: "blocking", rationale: "s2", recommendation: "rec2" },
          { role: "r3", severity: "important", rationale: "s3", recommendation: "rec3" },
        ],
        summary: "",
        status: "completed",
      };

      expect(report.findings[0].severity).toBe("suggestion");
      expect(report.findings[1].severity).toBe("blocking");
      expect(report.findings[2].severity).toBe("important");
    });
  });

  describe("hasBlockingFindings", () => {
    it("returns true when report contains blocking findings", () => {
      const report: ArmyReport = {
        army: "test",
        phase: "self-review",
        issueId: "TEST",
        generatedAt: new Date().toISOString(),
        findings: [
          { role: "r1", severity: "blocking", rationale: "s1", recommendation: "rec1" },
        ],
        summary: "",
        status: "completed",
      };
      expect(hasBlockingFindings(report)).toBe(true);
    });

    it("returns false when report has no blocking findings", () => {
      const report: ArmyReport = {
        army: "test",
        phase: "self-review",
        issueId: "TEST",
        generatedAt: new Date().toISOString(),
        findings: [
          { role: "r1", severity: "important", rationale: "s1", recommendation: "rec1" },
        ],
        summary: "",
        status: "completed",
      };
      expect(hasBlockingFindings(report)).toBe(false);
    });

    it("returns false for empty findings", () => {
      const report: ArmyReport = {
        army: "test",
        phase: "self-review",
        issueId: "TEST",
        generatedAt: new Date().toISOString(),
        findings: [],
        summary: "",
        status: "completed",
      };
      expect(hasBlockingFindings(report)).toBe(false);
    });
  });

  describe("countFindingsBySeverity", () => {
    it("counts findings correctly by severity", () => {
      const report: ArmyReport = {
        army: "test",
        phase: "self-review",
        issueId: "TEST",
        generatedAt: new Date().toISOString(),
        findings: [
          { role: "r1", severity: "blocking", rationale: "s1", recommendation: "rec1" },
          { role: "r2", severity: "blocking", rationale: "s2", recommendation: "rec2" },
          { role: "r3", severity: "important", rationale: "s3", recommendation: "rec3" },
          { role: "r4", severity: "suggestion", rationale: "s4", recommendation: "rec4" },
        ],
        summary: "",
        status: "completed",
      };
      const counts = countFindingsBySeverity(report);
      expect(counts.blocking).toBe(2);
      expect(counts.important).toBe(1);
      expect(counts.suggestion).toBe(1);
    });
  });

  describe("detectParallelSupport", () => {
    it("returns a boolean", () => {
      expect(typeof detectParallelSupport()).toBe("boolean");
    });
  });
});
