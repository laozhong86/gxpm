// Feature: events.jsonl skill-load attestation (PR-1 of D plan)
//
// As an autonomous agent advancing a gxpm issue
// I want every phase transition with a non-null requiredSkill to leave a
//   skill-load-required event in events.jsonl, and a paired skill-load-satisfied
//   event after I invoke the skill and run gxpm skill ack
// So that the audit trail captures whether I actually loaded the contract-mapped
//   skill before doing phase work — telemetry now, gate enforcement in PR-2.

import { describe, test, expect, afterEach } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GXPM_ENTRY = join(REPO_ROOT, "scripts/gxpm.ts");

interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runGxpm(args: string[], root: string): CliResult {
  const result = spawnSync("bun", ["run", GXPM_ENTRY, ...args], {
    cwd: root,
    encoding: "utf-8",
    env: { ...process.env, GXPM_ROOT: root, GXPM_TEST: "1", GXPM_BYPASS_ISSUE_NEXT_CHECK: "1" },
  });
  return { code: result.status ?? -1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function setupIssue(): { root: string; issueId: string } {
  const root = mkdtempSync(join(tmpdir(), "gxpm-skill-load-"));
  mkdirSync(join(root, ".gxpm"), { recursive: true });
  writeFileSync(
    join(root, ".gxpm", "config.json"),
    JSON.stringify({ worktree: { enforcement: "forbidden" } }),
  );
  const create = runGxpm(["issue", "create", "--auto-id"], root);
  if (create.code !== 0) {
    throw new Error(`create failed: ${create.stderr}`);
  }
  const issueId = create.stdout.match(/GXPM-\d+/)?.[0];
  if (!issueId) throw new Error(`could not parse issueId from: ${create.stdout}`);
  return { root, issueId };
}

function readEvents(root: string, issueId: string): Array<Record<string, unknown>> {
  const eventsPath = join(root, ".gxpm", "issues", issueId, "events.jsonl");
  if (!existsSync(eventsPath)) return [];
  return readFileSync(eventsPath, "utf-8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function writeMinimalArtifact(root: string, issueId: string, type: string, payload: Record<string, unknown>): void {
  // Bypass interactive init; just write the artifact directly via CLI.
  const result = runGxpm(
    ["artifact", "write", issueId, type, "--json", JSON.stringify(payload)],
    root,
  );
  if (result.code !== 0) {
    throw new Error(`artifact write ${type} failed: ${result.stderr}\n${result.stdout}`);
  }
}

function transition(root: string, issueId: string, next: string): CliResult {
  return runGxpm(["issue", "transition", issueId, next], root);
}

function advanceToPlan(root: string, issueId: string): void {
  // Triage → plan requires an acceptance-contract.
  writeMinimalArtifact(root, issueId, "acceptance-contract", {
    criteria: [{ id: "AC-1", text: "stub" }],
    status: "draft",
  });
  const t = transition(root, issueId, "plan");
  if (t.code !== 0) throw new Error(`transition to plan failed: ${t.stderr}`);
}

describe("events.jsonl skill-load attestation", () => {
  const cleanups: string[] = [];

  afterEach(() => {
    for (const path of cleanups) rmSync(path, { recursive: true, force: true });
    cleanups.length = 0;
  });

  test("scn-01: transition writes skill-load-required event when target phase requires a skill", () => {
    const { root, issueId } = setupIssue();
    cleanups.push(root);

    // Triage → plan; plan's requiredSkill = "gxpm-planning".
    writeMinimalArtifact(root, issueId, "acceptance-contract", {
      criteria: [{ id: "AC-1", text: "stub" }],
      status: "draft",
    });
    const result = transition(root, issueId, "plan");
    expect(result.code).toBe(0);

    const events = readEvents(root, issueId);
    const required = events.find((e) => e.type === "skill.load.required");
    expect(required, `events: ${JSON.stringify(events, null, 2)}`).toBeDefined();
    const payload = required!.payload as Record<string, unknown>;
    expect(payload.phase).toBe("plan");
    expect(payload.skill).toBe("gxpm-planning");
    expect(typeof payload.transitionId).toBe("string");
    expect(typeof required!.timestamp).toBe("string");
  });

  test("scn-02: gxpm skill ack writes satisfied event for the matching skill", () => {
    const { root, issueId } = setupIssue();
    cleanups.push(root);
    advanceToPlan(root, issueId);

    const ack = runGxpm(["skill", "ack", issueId, "gxpm-planning"], root);
    expect(ack.code, `stderr: ${ack.stderr}`).toBe(0);

    const events = readEvents(root, issueId);
    const satisfied = events.find(
      (e) => e.type === "skill.load.satisfied" && (e.payload as any).phase === "plan",
    );
    expect(satisfied, `events: ${JSON.stringify(events, null, 2)}`).toBeDefined();
    expect((satisfied!.payload as any).skill).toBe("gxpm-planning");
  });

  test("scn-03: gxpm skill ack rejects mismatched skill and names the expected skill", () => {
    const { root, issueId } = setupIssue();
    cleanups.push(root);
    advanceToPlan(root, issueId);

    const ack = runGxpm(["skill", "ack", issueId, "gxpm-triage"], root);
    expect(ack.code).not.toBe(0);
    expect(ack.stderr).toContain("gxpm-planning");

    const events = readEvents(root, issueId);
    const wrong = events.find(
      (e) =>
        e.type === "skill.load.satisfied" &&
        (e.payload as any).skill === "gxpm-triage",
    );
    expect(wrong).toBeUndefined();
  });

  test("scn-04: transition to a null-skill phase writes no skill-load-required", () => {
    const { root, issueId } = setupIssue();
    cleanups.push(root);
    advanceToPlan(root, issueId);

    // plan → dispatch; dispatch's requiredSkill = null.
    writeMinimalArtifact(root, issueId, "implementation-plan", {
      objective: "stub",
      approach: "stub",
      validation: { tests: [] },
    });
    const t = transition(root, issueId, "dispatch");
    expect(t.code, `stderr: ${t.stderr}`).toBe(0);

    const events = readEvents(root, issueId);
    const dispatchRequired = events.find(
      (e) =>
        e.type === "skill.load.required" && (e.payload as any).phase === "dispatch",
    );
    expect(dispatchRequired).toBeUndefined();
    // But the transition event itself must still be there.
    const dispatchTransitioned = events.find(
      (e) =>
        e.type === "phase.transitioned" && (e.payload as any).toPhase === "dispatch",
    );
    expect(dispatchTransitioned).toBeDefined();
  });

  test("scn-05: gxpm skill ack on terminal phase is rejected with a clear message", { timeout: 30_000 }, () => {
    const { root, issueId } = setupIssue();
    cleanups.push(root);

    // Cheap path to terminal: rewind isn't needed; directly transition through
    // standard rigor compressed flow up to land using minimal artifacts.
    // For test purposes, we synthesize a "land" state by writing state.json
    // directly is not allowed (CANON). Instead, walk the rigor=lite compressed
    // flow: triage→plan→specify→implement→self-review→ship→land.
    const minPayloads: Array<[string, string, Record<string, unknown>]> = [
      ["acceptance-contract", "plan", { criteria: [], status: "draft" }],
      [
        "implementation-plan",
        "specify",
        { objective: "x", approach: "x", validation: { tests: [] } },
      ],
      [
        "behavior-spec",
        "implement",
        {
          feature: { title: "x", asA: "x", iWant: "x", soThat: "x" },
          scenarios: [],
          confirmedAt: new Date().toISOString(),
          confirmedBy: "test",
        },
      ],
      ["local-verify", "self-review", { status: "passed", commands: [], results: [] }],
      [
        "cleanup-report",
        "ship",
        {
          status: "done",
          interfacesAligned: true,
          deadCodeRemoved: true,
          testsDeduplicated: true,
          duplicatesExtracted: true,
          renamesUnified: true,
        },
      ],
      [
        "ship-readiness",
        "qa",
        { status: "ready", checklist: [], rollbackPlan: "n/a" },
      ],
      ["qa-findings", "land", { status: "passed", findings: [], browserEvidence: [] }],
    ];
    // Set rigor to lite so the compressed transitions are accepted.
    const statePath = join(root, ".gxpm", "issues", issueId, "state.json");
    const stateJson = JSON.parse(readFileSync(statePath, "utf8"));
    stateJson.rigorLevel = "lite";
    writeFileSync(statePath, JSON.stringify(stateJson, null, 2));

    for (const [type, nextPhase, payload] of minPayloads) {
      writeMinimalArtifact(root, issueId, type, payload);
      // Some compressed transitions (e.g. qa→land) need land-findings up
      // front because the gate evaluates the destination phase's artifact.
      if (nextPhase === "land") {
        writeMinimalArtifact(root, issueId, "land-findings", {
          status: "landed",
          landReady: true,
          mergePlan: { branch: "x", base: "main", mergeMethod: "squash" },
        });
      }
      const t = transition(root, issueId, nextPhase);
      if (t.code !== 0) {
        throw new Error(`transition to ${nextPhase} failed: ${t.stderr}`);
      }
    }

    const ack = runGxpm(["skill", "ack", issueId, "gxpm-browser"], root);
    expect(ack.code).not.toBe(0);
    expect(ack.stderr.toLowerCase()).toMatch(/terminal|no required skill/);
  });

  test("scn-06: skill-load events from different phases stay isolated and paired", () => {
    const { root, issueId } = setupIssue();
    cleanups.push(root);

    // triage → plan (gxpm-planning) → dispatch (null) → specify (gxpm-specifier)
    writeMinimalArtifact(root, issueId, "acceptance-contract", {
      criteria: [],
      status: "draft",
    });
    expect(transition(root, issueId, "plan").code).toBe(0);
    expect(runGxpm(["skill", "ack", issueId, "gxpm-planning"], root).code).toBe(0);

    writeMinimalArtifact(root, issueId, "implementation-plan", {
      objective: "x",
      approach: "x",
      validation: { tests: [] },
    });
    expect(transition(root, issueId, "dispatch").code).toBe(0);
    // dispatch is null-skill; no ack needed.

    writeMinimalArtifact(root, issueId, "dispatch-handoff", {
      status: "ready",
      inputArtifacts: [],
      workerTasks: [],
    });
    expect(transition(root, issueId, "specify").code).toBe(0);
    expect(runGxpm(["skill", "ack", issueId, "gxpm-specifier"], root).code).toBe(0);

    const events = readEvents(root, issueId);
    const byPhase: Record<string, { required: number; satisfied: number; skills: Set<string> }> = {};
    for (const e of events) {
      if (e.type !== "skill.load.required" && e.type !== "skill.load.satisfied") continue;
      const p = (e.payload as any).phase as string;
      const s = (e.payload as any).skill as string;
      byPhase[p] = byPhase[p] ?? { required: 0, satisfied: 0, skills: new Set() };
      byPhase[p].skills.add(s);
      if (e.type === "skill.load.required") byPhase[p].required++;
      else byPhase[p].satisfied++;
    }
    expect(byPhase["plan"]).toEqual({ required: 1, satisfied: 1, skills: new Set(["gxpm-planning"]) });
    expect(byPhase["specify"]).toEqual({
      required: 1,
      satisfied: 1,
      skills: new Set(["gxpm-specifier"]),
    });
    expect(byPhase["dispatch"]).toBeUndefined();
  });
});
