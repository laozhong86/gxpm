import { mkdtempSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { hasArtifact, listArtifacts, readArtifact, writeArtifact } from "../../core/artifacts";
import { probeArtifactPayloadCommands } from "../../core/command-probe";
import { readJsonPayloadFromArgs } from "./helpers";
import { validateArtifact, formatValidationResult } from "../../core/artifact-validator";
import { assertIssueNextSeen } from "../../core/state";

// GXPM-141: artifact types that don't require issue-next anchoring.
// feedback-description is read-mostly cross-repo signal; allow without anchor.
const ANCHOR_EXEMPT_TYPES = new Set(["feedback-description"]);

export function runArtifactCommand(argv: string[], subcommand: string | undefined, issueId: string | undefined, type: string | undefined) {
  if (subcommand === "list") {
    if (!issueId) throw new Error("Usage: gxpm artifact list <issue-id>");
    const artifacts = listArtifacts({ issueId });
    if (artifacts.length === 0) {
      console.log("no artifacts");
      return;
    }
    for (const artifact of artifacts) {
      console.log(`${artifact.type}\t${artifact.path}\t${artifact.writtenAt}`);
    }
    return;
  }

  if (subcommand === "read") {
    if (!issueId || !type) throw new Error("Usage: gxpm artifact read <issue-id> <type>");
    console.log(JSON.stringify(readArtifact({ issueId, type }), null, 2));
    return;
  }

  if (subcommand === "write") {
    if (!issueId || !type) {
      throw new Error("Usage: gxpm artifact write <issue-id> <type> [--probe-cli] --json <json> | --from <file> | --stdin");
    }
    // GXPM-141: refuse writes from sessions that haven't re-anchored via
    // `gxpm issue next` after an ownership change. Exempts read-mostly types
    // (e.g. feedback-description).
    if (!ANCHOR_EXEMPT_TYPES.has(type)) {
      assertIssueNextSeen({ issueId });
    }
    runArtifactWrite(argv, issueId, type);
    return;
  }

  if (subcommand === "edit") {
    if (!issueId || !type) throw new Error("Usage: gxpm artifact edit <issue-id> <type>");
    if (!ANCHOR_EXEMPT_TYPES.has(type)) {
      assertIssueNextSeen({ issueId });
    }
    runArtifactEdit(issueId, type);
    return;
  }

  throw new Error(`Unknown command: ${["artifact", subcommand].filter(Boolean).join(" ")}`);
}

function runArtifactEdit(issueId: string, type: string) {
  const editor = process.env.EDITOR ?? process.env.VISUAL ?? "vi";

  let initial = "{}\n";
  if (hasArtifact({ issueId, type })) {
    const stored = readArtifact({ issueId, type });
    initial = `${JSON.stringify(stored.payload, null, 2)}\n`;
  }

  const tmpFile = join(
    mkdtempSync(join(tmpdir(), `gxpm-edit-${issueId}-${type}-`)),
    `${type}.json`,
  );
  writeFileSync(tmpFile, initial);

  const editorResult = Bun.spawnSync({
    cmd: [editor, tmpFile],
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });

  if (editorResult.exitCode !== 0) {
    console.error(`editor "${editor}" exited with code ${editorResult.exitCode}; tempfile preserved at ${tmpFile}`);
    process.exit(1);
  }

  const after = readFileSync(tmpFile, "utf8");
  let payload: unknown;
  try {
    payload = JSON.parse(after);
  } catch (error) {
    console.error(
      `gxpm artifact edit: invalid JSON saved by editor — ${error instanceof Error ? error.message : String(error)}`,
    );
    console.error(`Your edit is preserved at: ${tmpFile}`);
    process.exit(1);
  }

  writeArtifact({ issueId, type, payload });
  // best-effort cleanup
  try {
    unlinkSync(tmpFile);
  } catch {}
  console.log(`updated ${type} for ${issueId}`);
}

function runArtifactWrite(argv: string[], issueId: string, type: string) {
  const payload = readJsonPayloadFromArgs(argv, "gxpm artifact write");
  if (argv.includes("--probe-cli")) {
    const findings = probeArtifactPayloadCommands(payload);
    if (findings.length > 0) {
      const detail = findings.map((finding) => `${finding.command} (${finding.reason})`).join("\n");
      throw new Error(`gxpm artifact write: invalid command references\n${detail}`);
    }
  }
  const result = validateArtifact(type, asPayloadRecord(payload));
  if (!result.valid) {
    throw new Error(`gxpm artifact write: ${formatValidationResult(result)}`);
  }
  const record = writeArtifact({ issueId, type, payload });
  console.log(`wrote ${record.type} for ${issueId} at ${record.path}`);
}

function asPayloadRecord(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {};
  }
  return payload as Record<string, unknown>;
}
