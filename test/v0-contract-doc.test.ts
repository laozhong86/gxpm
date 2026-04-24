import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { ARTIFACT_TYPES } from "../core/artifacts";
import { PHASE_GATE_RULES } from "../core/phase-gates";
import { GXPM_PHASES } from "../core/state";

const doc = readFileSync("docs/architecture/gxpm-v0-contract.md", "utf8");

describe("gxpm V0 contract doc", () => {
  test("keeps phase list aligned with state graph", () => {
    expect(listUnderHeading("V0 phase 集合：")).toEqual([...GXPM_PHASES]);
  });

  test("keeps artifact type list aligned with artifact registry", () => {
    expect(listUnderHeading("V0 已支持 JSON artifact store。当前 artifact type：")).toEqual([
      ...ARTIFACT_TYPES,
    ]);
  });

  test("keeps artifact-backed transition guidance aligned with phase gates", () => {
    for (const rule of PHASE_GATE_RULES) {
      expect(doc).toContain(
        `\`${rule.fromPhase} -> ${rule.nextPhase}\` 额外要求存在 \`${rule.requiredArtifact}\` artifact。`,
      );
      expect(doc).toContain(`提示先运行 \`${rule.command}\``);
    }
  });

  test("keeps local command list aligned with phase gate commands", () => {
    const commands = codeBlockUnderHeading("## V0 本地命令");

    expect(commands).toContain("gxpm issue create <issue-id>");
    expect(commands).toContain("gxpm issue status <issue-id>");
    expect(commands).toContain("gxpm issue transition <issue-id> <phase>");
    expect(commands).toContain("gxpm artifact list <issue-id>");
    expect(commands).toContain("gxpm artifact read <issue-id> <type>");
    for (const rule of PHASE_GATE_RULES) {
      expect(commands).toContain(rule.command);
    }
  });
});

function listUnderHeading(heading: string) {
  const sectionStart = doc.indexOf(heading);
  if (sectionStart === -1) {
    throw new Error(`Missing heading: ${heading}`);
  }

  const rest = doc.slice(sectionStart + heading.length);
  const values: string[] = [];
  for (const line of rest.split("\n")) {
    const value = line.match(/^- `([^`]+)`$/)?.[1];
    if (value) {
      values.push(value);
      continue;
    }
    if (values.length > 0 && line.trim() !== "") {
      break;
    }
  }
  return values;
}

function codeBlockUnderHeading(heading: string) {
  const sectionStart = doc.indexOf(heading);
  if (sectionStart === -1) {
    throw new Error(`Missing heading: ${heading}`);
  }

  const section = doc.slice(sectionStart);
  const match = section.match(/```bash\n([\s\S]*?)\n```/);
  if (!match) {
    throw new Error(`Missing bash block under heading: ${heading}`);
  }

  return match[1].split("\n");
}
