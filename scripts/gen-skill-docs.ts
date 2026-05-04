import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";
import { discoverTemplates } from "./discover-skills";
import { getHostConfig } from "../hosts";
import type { HostConfig } from "../core/contracts/host";
import { PHASE_GATE_RULES } from "../core/phase-gates";

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

  // Static files (non-.tmpl) are read as-is without template rendering
  if (!templateRelative.endsWith(".tmpl")) {
    return source;
  }

  const rendered = renderTemplate(source, {
    artifactReadCommands: buildArtifactReadCommands(),
    phaseGateCommands: buildPhaseGateCommands(),
    phaseTransitionSummary: buildPhaseTransitionSummary(),
    preamble: buildPreamble(root, host),
    references: buildReferences(root, references),
  });
  return insertGeneratedMark(rendered);
}

export function generateSkillDocs(options: GenerateSkillDocsOptions = {}): string[] {
  const root = options.root ?? process.cwd();
  const host = getHostConfig(options.host ?? "codex");
  const outputs: string[] = [];
  const stale: string[] = [];

  for (const template of discoverTemplates(root)) {
    const outputPath = join(root, template.output);
    const generated = renderSkillContentForHost(root, host, template.tmpl, template.references);

    if (options.dryRun) {
      const current = existsSync(outputPath) ? readFileSync(outputPath, "utf8") : "";
      if (current !== generated) {
        stale.push(template.output);
      }
      continue;
    }

    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, generated);
    outputs.push(template.output);
  }

  if (stale.length > 0) {
    throw new Error(`Stale generated skill docs:\n${stale.map((path) => `- ${path}`).join("\n")}`);
  }

  return outputs;
}

interface TemplateVars {
  artifactReadCommands: string;
  phaseGateCommands: string;
  phaseTransitionSummary: string;
  preamble: string;
  references: Record<string, string>;
}

function renderTemplate(template: string, vars: TemplateVars) {
  let result = template
    .replaceAll("{{PREAMBLE}}", vars.preamble.trimEnd())
    .replaceAll("{{ARTIFACT_READ_COMMANDS}}", vars.artifactReadCommands)
    .replaceAll("{{PHASE_GATE_COMMANDS}}", vars.phaseGateCommands)
    .replaceAll("{{PHASE_TRANSITION_SUMMARY}}", vars.phaseTransitionSummary);

  for (const [name, content] of Object.entries(vars.references)) {
    result = result.replaceAll(`{{REFERENCE:${name}}}`, content);
  }

  return result;
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
