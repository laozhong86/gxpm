import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Feature: gxpm-review-army SKILL.md declares an explicit two-stage fan-out
//
// As an agent dispatching parallel reviewers in self-review
// I want the review-army skill to name a Stage 1 spec-compliance gate and a
//   Stage 2 quality fan-out (run only when Stage 1 passes)
// So that we adopt the superpowers subagent-driven-development discipline
//   (gate before fan-out) instead of one undifferentiated parallel review.

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SKILL_PATH = resolve(REPO_ROOT, "skills", "gxpm-review-army", "SKILL.md");

describe("GXPM-208 · gxpm-review-army declares two-stage fan-out", () => {
  test("test_skill_md_exists", () => {
    expect(existsSync(SKILL_PATH)).toBe(true);
  });

  // Scenario (scn-01): SKILL.md 含 Stage 1 / Stage 2 marker
  test("test_skill_md_declares_stage_1_and_stage_2", () => {
    const content = readFileSync(SKILL_PATH, "utf8");
    expect(content).toMatch(/Stage\s*1/);
    expect(content).toMatch(/Stage\s*2/);
  });

  // Scenario (scn-02): SKILL.md 显式说 Stage 2 仅在 Stage 1 pass 时启动
  // Codex P2 review: 单 ||  会让 doc 退化为 "Stage 1 pass" 或 "Stage 2 only" 任一即通过，
  // 弱化保护。要求 Stage 1 pass 语义 AND Stage 2 only-if 语义同时存在。
  test("test_skill_md_gates_stage_2_on_stage_1_pass", () => {
    const content = readFileSync(SKILL_PATH, "utf8");
    // 要求 Stage 1 含"门控 / 通过 / blocking" 语义
    const stage1HasGate =
      /Stage\s*1[\s\S]{0,400}?(?:门控|gate|通过|pass|无\s*blocking|没有\s*blocking)/i.test(content);
    // 同时要求 Stage 2 显式说仅在 Stage 1 通过时启动（"仅" / "only" / "if"）
    const stage2OnlyIfStage1 =
      /Stage\s*2[\s\S]{0,400}?(?:仅当\s*Stage\s*1|only\s*(?:if|when)\s*Stage\s*1|Stage\s*1[\s\S]{0,80}(?:通过|pass)[\s\S]{0,200}Stage\s*2)/i.test(content);
    expect(stage1HasGate).toBe(true);
    expect(stage2OnlyIfStage1).toBe(true);
  });

  // Scenario (scn-03): SKILL.md 每个 reviewer 含明确边界（输入 / 输出 schema）
  test("test_skill_md_documents_reviewer_io_contract", () => {
    const content = readFileSync(SKILL_PATH, "utf8");
    // 既有 Review Report JSON schema 段落应保留（reviewerName/severity/location/rationale/recommendation）
    expect(content).toContain("severity");
    expect(content).toContain("location");
    expect(content).toContain("rationale");
    expect(content).toContain("recommendation");
  });

  // Scenario (scn-04): SKILL.md 含并发上限说明（≤6 与 CLAUDE.md 一致）
  test("test_skill_md_declares_concurrency_cap", () => {
    const content = readFileSync(SKILL_PATH, "utf8");
    expect(content).toMatch(/≤\s*6|<=\s*6|不超过\s*6/);
  });
});
