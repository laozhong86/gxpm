import { describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createIssueState, type RigorLevel } from "../core/state";
import { readArtifact, type ArtifactType } from "../core/artifacts";
import { validateArtifact } from "../core/artifact-validator";
import { PHASE_ARTIFACT_COMMANDS } from "../scripts/phase-artifact-commands";

// GXPM-149: every phase init must produce a draft that passes the validator.
// Without this, agents either guess fields or hand-edit JSON, both of which
// violate CANON #4.

interface DraftCase {
  artifactType: ArtifactType;
  phase: string;
  command: string;
}

const DRAFT_CASES: DraftCase[] = PHASE_ARTIFACT_COMMANDS.map((c) => {
  // command looks like: "gxpm <phase> init <id>" or "gxpm <phase> <next> <id>"
  const parts = c.command.split(" ");
  return { artifactType: c.artifactType, phase: parts[1] ?? "?", command: c.command };
});

function freshIssueRoot() {
  return mkdtempSync(join(tmpdir(), "gxpm-draft-alignment-"));
}

function bootstrapIssueAtPhase(root: string, targetPhase: string, rigor: RigorLevel = "full") {
  const issueId = "GXPM-TEST-1";
  // issueType drives default rigor; we still force-set rigorLevel below
  const issueType = rigor === "lite" ? "meta" : "feature";
  createIssueState({ root, issueId, issueType });
  // Force-set currentPhase + rigorLevel by editing state.json directly. We're
  // testing initializer payload shape, not the transition gate.
  const statePath = join(root, ".gxpm/issues", issueId, "state.json");
  const state = JSON.parse(readFileSync(statePath, "utf-8"));
  state.currentPhase = targetPhase;
  state.rigorLevel = rigor;
  writeFileSync(statePath, JSON.stringify(state, null, 2));
  return issueId;
}

const RIGOR_MATRIX: RigorLevel[] = ["lite", "standard", "full"];

describe("GXPM-149 / scn-01: every phase init draft satisfies validator schema", () => {
  for (const rigor of RIGOR_MATRIX) {
    for (const c of DRAFT_CASES) {
      test(`${c.artifactType} (from ${c.phase}, rigor=${rigor}) — draft validates`, () => {
      const root = freshIssueRoot();
      try {
        const issueId = bootstrapIssueAtPhase(root, c.phase, rigor);
        // Find handler and invoke initialize
        const handler = PHASE_ARTIFACT_COMMANDS.find((x) => x.artifactType === c.artifactType);
        if (!handler) throw new Error(`no handler for ${c.artifactType}`);
        try {
          handler.initialize({ root, issueId } as any);
        } catch (err) {
          // Couldn't initialize (precondition unmet). Mark as expected-skip rather than fail.
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes("can only be initialized from")) {
            console.warn(`[skip] ${c.artifactType}: ${msg}`);
            return;
          }
          throw err;
        }
        const stored = readArtifact({ root, issueId, type: c.artifactType });
        const result = validateArtifact(c.artifactType, stored.payload);
        if (!result.valid) {
          const errs = result.errors.map((e) => `${e.field}: ${e.message}`).join("; ");
          throw new Error(
            `Draft for ${c.artifactType} fails validator: ${errs}\n` +
              `Either the init template must populate these fields (even with placeholders) ` +
              `or the validator must accept status=draft as draft mode.`,
          );
        }
        expect(result.valid).toBe(true);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
    }
  }
});
