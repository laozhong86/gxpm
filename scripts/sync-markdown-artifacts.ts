import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface StoredArtifact {
  schemaVersion: 1;
  issueId: string;
  type: string;
  writtenAt: string;
  payload: unknown;
}

const ARTIFACT_TO_MARKDOWN: Record<string, string> = {
  "acceptance-contract": "01-spec.md",
  "implementation-plan": "03-plan.md",
  "self-review": "04-review.md",
  "ship-readiness": "05-ship.md",
  "pr-check": "05-ship.md",
  "verify-findings": "05-ship.md",
  "qa-findings": "05-ship.md",
  "land-findings": "05-ship.md",
};

function artifactToMarkdown(artifact: StoredArtifact): string {
  const { type, writtenAt, payload } = artifact;
  const p = payload as Record<string, unknown>;

  const lines: string[] = [];
  lines.push(`# ${type}`);
  lines.push("");
  lines.push(`> Artifact type: \`${type}\``);
  lines.push(`> Written at: ${writtenAt}`);
  lines.push("");

  if (type === "acceptance-contract") {
    lines.push(`## Goal`);
    lines.push(String(p.goal ?? "N/A"));
    lines.push("");
    lines.push(`## Scope`);
    lines.push(String(p.scope ?? "N/A"));
    lines.push("");
    lines.push(`## Non-Goals`);
    lines.push(String(p.nonGoals ?? "N/A"));
    lines.push("");
    lines.push(`## Success Criteria`);
    lines.push(String(p.successCriteria ?? "N/A"));
    lines.push("");
    lines.push(`## Risks`);
    lines.push(String(p.risks ?? "N/A"));
  } else if (type === "implementation-plan") {
    lines.push(`## Objective`);
    lines.push(String(p.objective ?? "N/A"));
    lines.push("");
    lines.push(`## Scope`);
    lines.push(String(p.scope ?? "N/A"));
    lines.push("");
    lines.push(`## Constitution Check`);
    const cc = p.constitutionCheck as Record<string, unknown> | undefined;
    if (cc) {
      for (const [k, v] of Object.entries(cc)) {
        lines.push(`- ${k}: ${v}`);
      }
    }
    lines.push("");
    lines.push(`## Steps`);
    const steps = p.steps as Array<Record<string, unknown>> | undefined;
    if (steps) {
      for (const step of steps) {
        lines.push(`### ${step.id ?? "?"}: ${step.title ?? "?"}`);
        lines.push(String(step.description ?? ""));
        lines.push("");
        lines.push(`**Acceptance Criteria:** ${step.acceptanceCriteria ?? "N/A"}`);
        lines.push("");
      }
    }
  } else if (type === "self-review") {
    lines.push(`## Blocking`);
    const blocking = p.blocking as string[] | undefined;
    lines.push(blocking && blocking.length > 0 ? blocking.map((b) => `- ${b}`).join("\n") : "None");
    lines.push("");
    lines.push(`## Important`);
    const important = p.important as string[] | undefined;
    lines.push(important && important.length > 0 ? important.map((b) => `- ${b}`).join("\n") : "None");
    lines.push("");
    lines.push(`## Suggestions`);
    const suggestions = p.suggestions as string[] | undefined;
    lines.push(suggestions && suggestions.length > 0 ? suggestions.map((b) => `- ${b}`).join("\n") : "None");
    lines.push("");
    lines.push(`## Conclusion`);
    lines.push(String(p.conclusion ?? "N/A"));
  } else if (type === "ship-readiness") {
    lines.push(`## Ready`);
    lines.push(String(p.ready ?? "N/A"));
    lines.push("");
    lines.push(`## Ship Type`);
    lines.push(String(p.shipType ?? "N/A"));
    lines.push("");
    lines.push(`## Changes`);
    lines.push(String(p.changes ?? "N/A"));
    lines.push("");
    lines.push(`## Risk`);
    lines.push(String(p.risk ?? "N/A"));
    lines.push("");
    lines.push(`## Rollback`);
    lines.push(String(p.rollback ?? "N/A"));
  } else {
    lines.push("## Payload");
    lines.push("```json");
    lines.push(JSON.stringify(payload, null, 2));
    lines.push("```");
  }

  return lines.join("\n") + "\n";
}

function main() {
  const args = process.argv.slice(2);
  const issueId = args[0];
  if (!issueId) {
    console.error("Usage: bun run scripts/sync-markdown-artifacts.ts <issue-id>");
    process.exit(1);
  }

  const root = process.cwd();
  const artifactsDir = join(root, ".gxpm", "issues", issueId, "artifacts");
  const docsDir = join(root, ".gxpm", "issues", issueId, "docs");

  if (!existsSync(artifactsDir)) {
    console.error(`Artifacts directory not found: ${artifactsDir}`);
    process.exit(1);
  }

  mkdirSync(docsDir, { recursive: true });

  const artifacts = readdirSync(artifactsDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const content = readFileSync(join(artifactsDir, f), "utf8");
      return JSON.parse(content) as StoredArtifact;
    });

  const written: string[] = [];
  for (const artifact of artifacts) {
    const mdFile = ARTIFACT_TO_MARKDOWN[artifact.type];
    if (!mdFile) continue;

    const mdPath = join(docsDir, mdFile);
    const mdContent = artifactToMarkdown(artifact);

    // Append with separator if file already exists for multi-artifact types like 05-ship.md
    if (existsSync(mdPath)) {
      const existing = readFileSync(mdPath, "utf8");
      writeFileSync(mdPath, existing + "\n---\n\n" + mdContent);
    } else {
      writeFileSync(mdPath, mdContent);
    }
    written.push(`${artifact.type} → docs/${mdFile}`);
  }

  if (written.length === 0) {
    console.log("No markdown-mappable artifacts found.");
    return;
  }

  console.log(`Synced ${written.length} artifacts to markdown for ${issueId}:`);
  for (const line of written) {
    console.log(`  ${line}`);
  }
}



main();
