import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface GovernanceDocPreflightResult {
  ok: boolean;
  message?: string;
}

interface DocSpec {
  path: string;
  maxLines: number;
}

const DOCS: DocSpec[] = [
  { path: "AGENTS.md", maxLines: 150 },
  { path: "CLAUDE.md", maxLines: 80 },
];

function lineCount(filePath: string): number {
  if (!existsSync(filePath)) return 0;
  const text = readFileSync(filePath, "utf8");
  return text.split(/\r?\n/).length;
}

function dirtyDocs(root: string): Set<string> {
  try {
    const out = execFileSync(
      "git",
      ["diff", "--name-only", "--", ...DOCS.map((d) => d.path)],
      { cwd: root, encoding: "utf8" },
    ).trim();
    return new Set(out ? out.split("\n") : []);
  } catch {
    return new Set();
  }
}

export function runGovernanceDocPreflight(
  root: string = process.cwd(),
): GovernanceDocPreflightResult {
  const dirty = dirtyDocs(root);
  const offenders = DOCS.filter(
    (d) => dirty.has(d.path) && lineCount(join(root, d.path)) > d.maxLines,
  );

  if (offenders.length === 0) {
    return { ok: true };
  }

  const message = [
    "governance-doc-preflight: working-tree changes push docs past their governance cap:",
    ...offenders.map(
      (d) =>
        `  - ${d.path} = ${lineCount(join(root, d.path))} lines (cap ${d.maxLines})`,
    ),
    "",
    "Most often this is a recent `npx gitnexus analyze` / `bun run nexus:full`",
    "rewriting the GitNexus block. Working-tree edits that stay under the cap",
    "(e.g. an intentional doc change) are allowed.",
    "",
    "To recover before publish, run:",
    `  git checkout -- ${offenders.map((d) => d.path).join(" ")}`,
    "",
    "Next time refresh the index with `bun run nexus` (uses --skip-agents-md).",
  ].join("\n");

  return { ok: false, message };
}
