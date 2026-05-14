import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

export interface SkillStructureViolation {
  skillPath: string;
  missing: string[];
  warnings: string[];
}

const REQUIRED_SECTIONS = [
  {
    id: "entry",
    names: ["入口条件", "入口", "触发条件", "Entry Conditions", "When to Use", "Recognition criteria"],
    label: "入口条件 (Entry Conditions)",
  },
  {
    id: "process",
    names: ["可操作流程", "流程", "操作步骤", "Process", "Steps", "Workflow"],
    label: "可操作流程 (Process)",
  },
  {
    id: "redflags",
    names: ["红旗清单", "红旗", "反模式", "常见陷阱", "Red Flags", "Anti-Patterns", "Pitfalls"],
    label: "红旗/反模式 (Red Flags)",
  },
  {
    id: "verification",
    names: ["验证清单", "出口条件", "验证", "Checklist", "Verification", "Exit Conditions"],
    label: "验证清单/出口条件 (Verification)",
  },
];

const OPTIONAL_SECTIONS = [
  {
    id: "phrases",
    names: ["常见说辞表", "说辞", "Phrases", "Common Phrases"],
    label: "常见说辞表 (Common Phrases)",
  },
];

function hasSection(content: string, names: string[]): boolean {
  const pattern = new RegExp(
    `^#{2,3}\\s*(?:\\[[ x]\\]\\s*)?(${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
    "im",
  );
  return pattern.test(content);
}

function walkDir(dir: string, callback: (path: string) => void) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith(".")) {
      walkDir(fullPath, callback);
    } else if (entry.isFile()) {
      callback(fullPath);
    }
  }
}

export function validateSkillStructure(root: string): SkillStructureViolation[] {
  const violations: SkillStructureViolation[] = [];
  const skillsDir = join(root, "skills");

  if (!existsSync(skillsDir)) {
    return [{ skillPath: "skills/", missing: ["skills directory not found"], warnings: [] }];
  }

  walkDir(skillsDir, (fullPath: string) => {
    if (!fullPath.endsWith("SKILL.md")) return;
    const content = readFileSync(fullPath, "utf-8");
    const relPath = relative(root, fullPath);
    const missing: string[] = [];
    const warnings: string[] = [];

    for (const section of REQUIRED_SECTIONS) {
      if (!hasSection(content, section.names)) {
        missing.push(section.label);
      }
    }

    for (const section of OPTIONAL_SECTIONS) {
      if (!hasSection(content, section.names)) {
        warnings.push(`可选: ${section.label}`);
      }
    }

    // Gatekeeping skills (workflow/verify/ship) should have phrases
    if (/\b(triage|plan|verify|review|ship|debug|diagnose|hygiene)\b/.test(relPath)) {
      if (!hasSection(content, OPTIONAL_SECTIONS[0].names)) {
        warnings.push(`建议补充: ${OPTIONAL_SECTIONS[0].label} (此 skill 涉及 gatekeeping 或交互)`);
      }
    }

    if (missing.length > 0 || warnings.length > 0) {
      violations.push({ skillPath: relPath, missing, warnings });
    }
  });

  return violations;
}

export function formatSkillStructureErrors(violations: SkillStructureViolation[]): { errors: string[]; warnings: string[] } {
  if (violations.length === 0) return { errors: [], warnings: [] };

  const errors: string[] = [];
  const warnings: string[] = [];
  const missingOnly = violations.filter((v) => v.missing.length > 0);
  const warningOnly = violations.filter((v) => v.missing.length === 0 && v.warnings.length > 0);

  if (missingOnly.length > 0) {
    errors.push(`SKILL.md structure violations found: ${missingOnly.length} skill(s) missing required sections`);
    for (const v of missingOnly) {
      errors.push(`\n  ${v.skillPath}:`);
      for (const m of v.missing) {
        errors.push(`    ❌ MISSING: ${m}`);
      }
      for (const w of v.warnings) {
        errors.push(`    ⚠️  ${w}`);
      }
    }
  }

  if (warningOnly.length > 0) {
    warnings.push(`SKILL.md structure warnings: ${warningOnly.length} skill(s) with optional section gaps`);
    for (const v of warningOnly) {
      warnings.push(`\n  ${v.skillPath}:`);
      for (const w of v.warnings) {
        warnings.push(`    ⚠️  ${w}`);
      }
    }
  }

  const guide = [
    "\nEach SKILL.md must contain these sections (## or ### heading):",
    "  1. 入口条件 / Entry Conditions / Recognition criteria / When to Use",
    "  2. 可操作流程 / Process / Steps / Workflow",
    "  3. 红旗清单 / 反模式 / Red Flags / Anti-Patterns / Pitfalls",
    "  4. 验证清单 / 出口条件 / Verification / Checklist",
    "Optional but recommended for gatekeeping skills:",
    "  5. 常见说辞表 / Common Phrases",
  ];

  return {
    errors: errors.length > 0 ? [...errors, ...guide] : [],
    warnings: warnings.length > 0 ? [...warnings, ...guide] : [],
  };
}

if (import.meta.main) {
  const root = process.argv[2] ?? resolve(import.meta.dir, "..");
  const violations = validateSkillStructure(root);
  if (violations.length > 0) {
    console.error(formatSkillStructureErrors(violations).join("\n"));
    process.exit(1);
  }
  console.log("All SKILL.md files conform to the five-section structure.");
}
