import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";
import { discoverTemplates } from "./discover-skills";
import { getHostConfig } from "../hosts";
import type { HostConfig } from "../core/contracts/host";
import { PHASE_GATE_RULES } from "../core/phase-gates";
import { renderTemplate } from "../core/converters/template-renderer";
import { SkillParser, HostConverter, SkillWriter } from "../core/converters";
import { PresetResolver } from "../core/preset-system/preset-resolver";

export interface GenerateSkillDocsOptions {
  root?: string;
  host?: string;
  dryRun?: boolean;
}

const GENERATED_MARK = "<!-- AUTO-GENERATED from SKILL.md.tmpl - do not edit directly -->";

export function renderSkillContentForHost(
  root: string,
  host: HostConfig,
  templateRelative: string,
  references?: string[],
): string {
  const templatePath = join(root, templateRelative);
  const source = readFileSync(templatePath, "utf8");

  // Static files (non-.tmpl) are returned as-is for backward compatibility
  if (!templateRelative.endsWith(".tmpl")) {
    return source;
  }

  // Template files keep string-replacement behavior for backward compatibility
  const rendered = renderTemplate(source, {
    PREAMBLE: buildPreamble(root, host),
    ARTIFACT_READ_COMMANDS: buildArtifactReadCommands(),
    PHASE_GATE_COMMANDS: buildPhaseGateCommands(),
    PHASE_TRANSITION_SUMMARY: buildPhaseTransitionSummary(),
    PHASE_REQUIRED_SKILL_TABLE: buildPhaseRequiredSkillTable(),
    references: buildReferences(root, references),
  });
  return insertGeneratedMark(rendered);
}

export function generateSkillDocs(options: GenerateSkillDocsOptions = {}): string[] {
  const root = options.root ?? process.cwd();
  const host = getHostConfig(options.host ?? "codex");
  const outputs: string[] = [];
  const stale: string[] = [];

  // Load preset resolver for composition layer support
  const resolver = new PresetResolver(root);
  resolver.load();

  for (const template of discoverTemplates(root)) {
    const outputPath = join(root, template.output);
    const generated = renderSkillContentForHost(root, host, template.tmpl, template.references);

    // Apply Override > Preset > Core resolution
    const resolved = resolver.resolve(template.output, generated);
    const finalContent = resolved?.content ?? generated;

    if (options.dryRun) {
      const current = existsSync(outputPath) ? readFileSync(outputPath, "utf8") : "";
      if (current !== finalContent) {
        stale.push(template.output);
      }
      continue;
    }

    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, finalContent);
    outputs.push(template.output);
  }

  if (stale.length > 0) {
    throw new Error(`Stale generated skill docs:\n${stale.map((path) => `- ${path}`).join("\n")}`);
  }

  return outputs;
}

function buildReferences(root: string, references?: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  if (!references) return result;
  for (const refPath of references) {
    const name = refPath.replace(/^.*\//, "").replace(/\.md$/, "");
    const content = readFileSync(join(root, refPath), "utf8");
    result[name] = content;
  }
  return result;
}

function insertGeneratedMark(content: string) {
  const frontmatter = content.match(/^---\n[\s\S]*?\n---\n?/);
  if (!frontmatter) {
    return `${GENERATED_MARK}\n\n${content}`;
  }

  const head = frontmatter[0].trimEnd();
  const body = content.slice(frontmatter[0].length).replace(/^\n+/, "");
  return `${head}\n${GENERATED_MARK}\n\n${body}`;
}

function buildPreamble(_root: string, host: ReturnType<typeof getHostConfig>) {
  const envLines = host.usesEnvVars
    ? [
        'GXPM_ROOT="${GXPM_ROOT:-$PWD}"',
        `GXPM_STATE_DIR="\${GXPM_STATE_DIR:-$GXPM_ROOT/.gxpm}"`,
        "export GXPM_ROOT GXPM_STATE_DIR",
      ]
    : ['GXPM_ROOT="${GXPM_ROOT:-$PWD}"', "export GXPM_ROOT"];

  return [
    "## Host Preamble",
    "",
    `Target host: ${host.displayName}.`,
    "",
    "```bash",
    ...envLines,
    "```",
  ].join("\n");
}

function buildArtifactReadCommands() {
  return PHASE_GATE_RULES.map((rule) => `gxpm artifact read <issue-id> ${rule.requiredArtifact}`).join(
    "\n",
  );
}

function buildPhaseGateCommands() {
  return PHASE_GATE_RULES.map((rule) =>
    [
      `Before leaving \`${rule.fromPhase}\`, initialize \`${rule.requiredArtifact}\`:`,
      "",
      "```bash",
      rule.command,
      "```",
    ].join("\n"),
  ).join("\n\n");
}

function buildPhaseRequiredSkillTable() {
  // Phase → Required Skill contract (REQUIRED SUB-SKILL pattern).
  // Source of truth: PHASE_GATE_RULES.requiredSkill in core/phase-gates.ts.
  // Surfaced both by `gxpm issue next` (text + --json) and this main SKILL.md
  // table so cold-start agents see the contract before running any command.
  const header = [
    "| 当前阶段 | REQUIRED SKILL（进入即 invoke） | 备注 |",
    "|---|---|---|",
  ];
  const rows = PHASE_GATE_RULES.map((rule) => {
    const skill = rule.requiredSkill ? `\`/${rule.requiredSkill}\`` : "—";
    const note = rule.requiredSkill
      ? `进入 \`${rule.fromPhase}\` 前必须先 invoke 该 skill，再做任何代码或 artifact 写入`
      : "机械 CLI 步骤，无需 skill 介入";
    return `| \`${rule.fromPhase}\` | ${skill} | ${note} |`;
  });
  return [...header, ...rows].join("\n");
}

function buildPhaseTransitionSummary() {
  const gateSummary = PHASE_GATE_RULES.map(
    (rule) =>
      `\`${rule.fromPhase} -> ${rule.nextPhase}\` is blocked until \`${rule.requiredArtifact}\` exists.`,
  ).join(" ");

  return [
    "V0 phase transitions are strict.",
    "Use `gxpm issue transition <issue-id> <next-phase>` only for the next phase in the phase map.",
    gateSummary,
  ].join(" ");
}

function parseArgs(argv: string[]) {
  const options: GenerateSkillDocsOptions = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--host") {
      options.host = argv[++index];
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--root") {
      options.root = argv[++index];
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

if (import.meta.main) {
  try {
    const outputs = generateSkillDocs(parseArgs(Bun.argv.slice(2)));
    if (outputs.length > 0) {
      console.log(outputs.map((path) => `generated ${path}`).join("\n"));
    } else {
      console.log("skill docs are current");
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
