import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { writeArtifact } from "./artifacts";
import { readIssueState } from "./state";
import { resolveAgentIdentity } from "./session";
import { BehaviorSpecSchema, type BehaviorSpec } from "./contracts/behavior-spec.schema";

interface SpecifyInput {
  root?: string;
  issueId: string;
}

export function initializeSpecify(input: SpecifyInput) {
  const state = readIssueState({ root: input.root, issueId: input.issueId });
  if (state.currentPhase !== "specify") {
    throw new Error(
      `Specify can only be initialized from specify phase: current phase is ${state.currentPhase}`,
    );
  }

  const now = new Date().toISOString();
  const identity = resolveAgentIdentity();

  const payload = {
    $schema: "behavior-spec.v1",
    issueId: input.issueId,
    createdAt: now,
    createdBy: identity.actor,
    confirmedAt: null,
    confirmedBy: null,
    feature: {
      title: "<placeholder>",
      asA: "<placeholder>",
      iWant: "<placeholder>",
      soThat: "<placeholder>",
    },
    scenarios: [
      {
        id: "scn-01",
        name: "<placeholder>",
        given: ["<placeholder>"],
        when: "<placeholder>",
        then: ["<placeholder>"],
        examples: [],
        stubPath: "<placeholder>",
      },
    ],
    guidelinesRef: "docs/governance/gherkin-style.md@v1",
  };

  return writeArtifact({
    root: input.root,
    issueId: input.issueId,
    type: "behavior-spec",
    payload,
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ConfirmInput {
  root?: string;
  issueId: string;
  confirmedBy?: string;
}

function gitUserEmail(): string {
  try {
    return execSync("git config user.email", { encoding: "utf8" }).trim();
  } catch {
    return "unknown@local";
  }
}

function specArtifactPath(root: string, issueId: string): string {
  return join(root, ".gxpm", "issues", issueId, "artifacts", "behavior-spec.json");
}

function readStoredSpec(root: string, issueId: string): { stored: { payload: BehaviorSpec; [key: string]: unknown } } {
  const path = specArtifactPath(root, issueId);
  if (!existsSync(path)) {
    throw new Error(
      `behavior-spec.json not found for ${issueId}; run \`gxpm specify init ${issueId}\` first`,
    );
  }
  const stored = JSON.parse(readFileSync(path, "utf8"));
  BehaviorSpecSchema.parse(stored.payload);
  return { stored };
}

const PLACEHOLDER_SENTINEL = "<placeholder>";

function findRemainingPlaceholders(spec: BehaviorSpec): string[] {
  const violations: string[] = [];
  const f = spec.feature;
  for (const [key, val] of Object.entries(f)) {
    if (val === PLACEHOLDER_SENTINEL) violations.push(`feature.${key}`);
  }
  spec.scenarios.forEach((scn, idx) => {
    const tag = `scenarios[${idx}]`;
    if (scn.name === PLACEHOLDER_SENTINEL) violations.push(`${tag}.name`);
    if (scn.when === PLACEHOLDER_SENTINEL) violations.push(`${tag}.when`);
    if (scn.stubPath === PLACEHOLDER_SENTINEL) violations.push(`${tag}.stubPath`);
    scn.given.forEach((g, i) => {
      if (g === PLACEHOLDER_SENTINEL) violations.push(`${tag}.given[${i}]`);
    });
    scn.then.forEach((t, i) => {
      if (t === PLACEHOLDER_SENTINEL) violations.push(`${tag}.then[${i}]`);
    });
  });
  return violations;
}

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

export function confirmSpecify(input: ConfirmInput) {
  const root = input.root ?? process.cwd();
  const { stored } = readStoredSpec(root, input.issueId);
  const spec = stored.payload;

  const placeholders = findRemainingPlaceholders(spec);
  if (placeholders.length > 0) {
    throw new Error(
      `Cannot confirm: <placeholder> sentinels remain in: ${placeholders.join(", ")}`,
    );
  }

  for (const scn of spec.scenarios) {
    const file = scn.stubPath.split(":")[0];
    const abs = join(root, file);
    if (!existsSync(abs)) {
      throw new Error(`Stub file missing: ${scn.stubPath} (scenario ${scn.id})`);
    }
  }

  const now = new Date().toISOString();
  const confirmedBy = input.confirmedBy ?? gitUserEmail();
  stored.payload.confirmedAt = now;
  stored.payload.confirmedBy = confirmedBy;
  writeFileSync(
    specArtifactPath(root, input.issueId),
    `${JSON.stringify(stored, null, 2)}\n`,
  );
}

export function reviseSpecify(input: { root?: string; issueId: string }) {
  const root = input.root ?? process.cwd();
  const { stored } = readStoredSpec(root, input.issueId);
  stored.payload.confirmedAt = null;
  stored.payload.confirmedBy = null;
  writeFileSync(
    specArtifactPath(root, input.issueId),
    `${JSON.stringify(stored, null, 2)}\n`,
  );
}
