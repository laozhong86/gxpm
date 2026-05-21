import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";

describe("scaffold-check (Army Agents)", () => {
  describe("agent structure validation", () => {
    it("all review-army agents have frontmatter with name and description", () => {
      const agents = [
        "agents/review-army/spec-compliance-reviewer.md",
        "agents/review-army/code-quality-reviewer.md",
        "agents/review-army/security-reviewer.md",
        "agents/review-army/test-reviewer.md",
        "agents/review-army/accessibility-reviewer.md",
      ];

      for (const path of agents) {
        const content = readFileSync(path, "utf8");
        expect(content).toMatch(/^---\s*$/m);
        expect(content).toMatch(/name:\s*\S+/);
        expect(content).toMatch(/description:\s*\S+/);
      }
    });

    it("all ship-audit-army agents have frontmatter with name and description", () => {
      const agents = [
        "agents/ship-audit-army/security-auditor.md",
        "agents/ship-audit-army/performance-auditor.md",
        "agents/ship-audit-army/docs-auditor.md",
      ];

      for (const path of agents) {
        const content = readFileSync(path, "utf8");
        expect(content).toMatch(/^---\s*$/m);
        expect(content).toMatch(/name:\s*\S+/);
        expect(content).toMatch(/description:\s*\S+/);
      }
    });

    it("all army agents have HARD-GATE or 红旗清单 section", () => {
      const agents = [
        "agents/review-army/spec-compliance-reviewer.md",
        "agents/review-army/code-quality-reviewer.md",
        "agents/review-army/security-reviewer.md",
        "agents/review-army/test-reviewer.md",
        "agents/review-army/accessibility-reviewer.md",
        "agents/ship-audit-army/security-auditor.md",
        "agents/ship-audit-army/performance-auditor.md",
        "agents/ship-audit-army/docs-auditor.md",
      ];

      for (const path of agents) {
        const content = readFileSync(path, "utf8");
        const hasHardGate = /##\s*(红旗清单|HARD-GATE|Hard Gate|Hard Gates)/i.test(content);
        expect(hasHardGate).toBe(true);
      }
    });

    it("all army agents have verification checklist section", () => {
      const agents = [
        "agents/review-army/spec-compliance-reviewer.md",
        "agents/review-army/code-quality-reviewer.md",
        "agents/review-army/security-reviewer.md",
        "agents/review-army/test-reviewer.md",
        "agents/review-army/accessibility-reviewer.md",
        "agents/ship-audit-army/security-auditor.md",
        "agents/ship-audit-army/performance-auditor.md",
        "agents/ship-audit-army/docs-auditor.md",
      ];

      for (const path of agents) {
        const content = readFileSync(path, "utf8");
        const hasChecklist = /##\s*(验证清单|验证|Checklist|Verification)/i.test(content);
        expect(hasChecklist).toBe(true);
      }
    });

    it("has no placeholder content in army agents", () => {
      const agents = [
        "agents/review-army/spec-compliance-reviewer.md",
        "agents/review-army/code-quality-reviewer.md",
        "agents/review-army/security-reviewer.md",
        "agents/review-army/test-reviewer.md",
        "agents/review-army/accessibility-reviewer.md",
        "agents/ship-audit-army/security-auditor.md",
        "agents/ship-audit-army/performance-auditor.md",
        "agents/ship-audit-army/docs-auditor.md",
      ];

      for (const path of agents) {
        const content = readFileSync(path, "utf8");
        expect(content).not.toMatch(/\bSTUB\b|\bPLACEHOLDER\b|待补充|^TODO\s*$/im);
      }
    });

    it("gxpm-review-army skill has complete structure", () => {
      const content = readFileSync("skills/gxpm-review-army/SKILL.md", "utf8");
      expect(content).toMatch(/^---\s*$/m);
      // The skill now uses bilingual headings such as
      // "## When to trigger（入口条件）" — assert the Chinese half still
      // appears inside an H2 line.
      expect(content).toMatch(/^##\s*.*入口条件/m);
      expect(content).toMatch(/^##\s*.*可操作流程/m);
      expect(content).toMatch(/^##\s*.*红旗清单/m);
      expect(content).toMatch(/^##\s*.*验证清单/m);
      expect(content).toMatch(/^##\s*.*常见说辞表/m);
    });
  });
});
