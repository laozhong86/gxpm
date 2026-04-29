import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { dirname } from "node:path";
import { output, runCli, runCliWithInput } from "./helpers/workflow";

const cliPath = resolve(import.meta.dir, "..", "scripts", "gxpm.ts");

describe("gxpm CLI", () => {
  test("prints the resolved session id", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-session-cli-"));

    const result = runCli(root, ["session-id"]);

    expect(result.exitCode).toBe(0);
    expect(output(result)).toMatch(/^(codex|cmux|gen):/m);
  });

  test("creates, reads, and transitions local issue state", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-cli-"));

    const create = runCli(root, ["issue", "create", "GXPM-10"]);
    expect(create.exitCode).toBe(0);
    expect(output(create)).toContain("created GXPM-10 at triage");

    const initialStatus = runCli(root, ["issue", "status", "GXPM-10"]);
    expect(initialStatus.exitCode).toBe(0);
    expect(output(initialStatus)).toContain("currentPhase: triage");

    const triage = runCli(root, ["triage", "init", "GXPM-10"]);
    expect(triage.exitCode).toBe(0);
    expect(output(triage)).toContain("initialized triage artifacts for GXPM-10");

    const transition = runCli(root, ["issue", "transition", "GXPM-10", "plan"]);
    expect(transition.exitCode).toBe(0);
    expect(output(transition)).toContain("transitioned GXPM-10: triage -> plan");

    const nextStatus = runCli(root, ["issue", "status", "GXPM-10"]);
    expect(nextStatus.exitCode).toBe(0);
    expect(output(nextStatus)).toContain("currentPhase: plan");
  });

  test("returns non-zero for invalid phase transitions", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-cli-invalid-"));
    expect(runCli(root, ["issue", "create", "GXPM-11"]).exitCode).toBe(0);

    const invalid = runCli(root, ["issue", "transition", "GXPM-11", "dispatch"]);

    expect(invalid.exitCode).toBe(1);
    expect(output(invalid)).toContain("Invalid phase transition");
    expect(output(invalid)).toContain("allowed next phase: plan");
  });
});

describe("gxpm issue ownership CLI", () => {
  test("shows current owner and ownership history", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-ownership-cli-"));
    expect(runCli(root, ["issue", "create", "GXPM-80"]).exitCode).toBe(0);

    const read = runCli(root, ["issue", "ownership", "GXPM-80"]);
    expect(read.exitCode).toBe(0);
    expect(output(read)).toContain("currentSession:");
    expect(output(read)).toContain("history:");
    expect(output(read)).toContain("session\tfirstTouch\tlastTouch");
  });

  test("supports hook-oriented ownership flags", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-ownership-cli-flags-"));
    expect(runCli(root, ["issue", "create", "GXPM-81"]).exitCode).toBe(0);

    const field = runCli(root, ["issue", "ownership", "GXPM-81", "--field", "currentSession"]);
    expect(field.exitCode).toBe(0);
    expect(output(field)).toMatch(/^(codex|cmux|gen):/m);

    const contains = runCli(root, ["issue", "ownership", "GXPM-81", "--history-contains", output(field).trim()]);
    expect(contains.exitCode).toBe(0);
  });
});

describe("gxpm issue history CLI", () => {
  test("shows event timeline for a freshly created issue", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-history-fresh-"));
    expect(runCli(root, ["issue", "create", "GXPM-50"]).exitCode).toBe(0);

    const r = runCli(root, ["issue", "history", "GXPM-50"]);
    expect(r.exitCode).toBe(0);
    const out = output(r);
    expect(out).toContain("GXPM-50");
    expect(out).toContain("issue.created");
    expect(out).toContain("triage");
  });

  test("includes phase transitions and artifact events", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-history-walk-"));
    expect(runCli(root, ["issue", "create", "GXPM-51"]).exitCode).toBe(0);
    expect(runCli(root, ["triage", "init", "GXPM-51"]).exitCode).toBe(0);
    expect(runCli(root, ["issue", "transition", "GXPM-51", "plan"]).exitCode).toBe(0);

    const r = runCli(root, ["issue", "history", "GXPM-51"]);
    const out = output(r);
    expect(out).toContain("artifact.written");
    expect(out).toContain("acceptance-contract");
    expect(out).toContain("phase.transitioned");
    expect(out).toContain("triage → plan");
    expect(out).toContain("gate.passed");
  });

  test("--json outputs machine-readable timeline", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-history-json-"));
    expect(runCli(root, ["issue", "create", "GXPM-52"]).exitCode).toBe(0);

    const r = runCli(root, ["issue", "history", "GXPM-52", "--json"]);
    expect(r.exitCode).toBe(0);
    const events = JSON.parse(output(r));
    expect(Array.isArray(events)).toBe(true);
    expect(events[0].type).toBe("issue.created");
    expect(events[0].issueId).toBe("GXPM-52");
  });

  test("returns non-zero for unknown issue", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-history-missing-"));
    const r = runCli(root, ["issue", "history", "GXPM-NOPE"]);
    expect(r.exitCode).toBe(1);
  });
});

describe("gxpm issue next CLI", () => {
  test("recommends triage init when at triage with no artifact", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-next-triage-"));
    expect(runCli(root, ["issue", "create", "GXPM-30"]).exitCode).toBe(0);

    const r = runCli(root, ["issue", "next", "GXPM-30"]);
    expect(r.exitCode).toBe(0);
    const out = output(r);
    expect(out).toContain("currentPhase: triage");
    expect(out).toContain("gxpm triage init GXPM-30");
    expect(out).toContain("acceptance-contract");
  });

  test("recommends transition when artifact exists for current phase", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-next-after-init-"));
    expect(runCli(root, ["issue", "create", "GXPM-31"]).exitCode).toBe(0);
    expect(runCli(root, ["triage", "init", "GXPM-31"]).exitCode).toBe(0);

    const r = runCli(root, ["issue", "next", "GXPM-31"]);
    expect(r.exitCode).toBe(0);
    const out = output(r);
    expect(out).toContain("gxpm issue transition GXPM-31 plan");
  });

  test("indicates terminal state when at land", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-next-land-"));
    // walk all the way to land
    expect(runCli(root, ["issue", "create", "GXPM-32"]).exitCode).toBe(0);
    // Use the helper: create + walk through all phases
    const phases: Array<[string, string, string]> = [
      ["triage", "init", "plan"],
      ["plan", "init", "dispatch"],
      ["dispatch", "init", "implement"],
      ["implement", "verify", "local-verify"],
      ["local-verify", "ac-check", "ac-check"],
      ["ac-check", "self-review", "self-review"],
      ["self-review", "ship", "ship"],
      ["ship", "pr-check", "pr-check"],
      ["pr-check", "verify", "verify"],
      ["verify", "qa", "qa"],
      ["qa", "land", "land"],
    ];
    for (const [cmd, sub, next] of phases) {
      runCli(root, [cmd, sub, "GXPM-32"]);
      runCli(root, ["issue", "transition", "GXPM-32", next]);
    }

    const r = runCli(root, ["issue", "next", "GXPM-32"]);
    expect(r.exitCode).toBe(0);
    expect(output(r)).toMatch(/land|terminal|complete/i);
  });

  test("returns non-zero for missing issue", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-next-missing-"));
    const r = runCli(root, ["issue", "next", "GXPM-NOPE"]);
    expect(r.exitCode).toBe(1);
  });
});

describe("gxpm artifact write CLI", () => {
  test("writes artifact when --probe-cli validates referenced commands", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-art-write-probe-ok-"));
    expect(runCli(root, ["issue", "create", "GXPM-25"]).exitCode).toBe(0);

    const payload = JSON.stringify({
      summary: "verified commands",
      commands: "Use `gxpm issue status GXPM-25` before writing.",
    });

    const r = runCli(root, [
      "artifact", "write", "GXPM-25", "triage-report",
      "--json", payload,
      "--probe-cli",
    ]);

    expect(r.exitCode).toBe(0);
    expect(output(r)).toContain("wrote triage-report");
  });

  test("fails before write when --probe-cli finds an invalid gxpm command", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-art-write-probe-bad-"));
    expect(runCli(root, ["issue", "create", "GXPM-26"]).exitCode).toBe(0);

    const payload = JSON.stringify({
      summary: "bad command",
      commands: "Run `gxpm definitely-not-a-command GXPM-26` first.",
    });

    const r = runCli(root, [
      "artifact", "write", "GXPM-26", "triage-report",
      "--json", payload,
      "--probe-cli",
    ]);

    expect(r.exitCode).toBe(1);
    expect(output(r)).toContain("invalid command references");
    expect(output(r)).toContain("gxpm definitely-not-a-command GXPM-26");

    const read = runCli(root, ["artifact", "read", "GXPM-26", "triage-report"]);
    expect(read.exitCode).toBe(1);
    expect(output(read)).toContain("Artifact not found");
  });

  test("ignores inline prose when --probe-cli finds no supported command prefixes", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-art-write-probe-ignore-"));
    expect(runCli(root, ["issue", "create", "GXPM-27"]).exitCode).toBe(0);

    const payload = JSON.stringify({
      summary: "plain text",
      note: "Say hello to the workflow without naming a command.",
    });

    const r = runCli(root, [
      "artifact", "write", "GXPM-27", "triage-report",
      "--json", payload,
      "--probe-cli",
    ]);

    expect(r.exitCode).toBe(0);
    expect(output(r)).toContain("wrote triage-report");
  });

  test("writes artifact from --json flag", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-art-write-json-"));
    expect(runCli(root, ["issue", "create", "GXPM-20"]).exitCode).toBe(0);

    const r = runCli(root, [
      "artifact", "write", "GXPM-20", "acceptance-contract",
      "--json", '{"criteria":[{"id":"AC-1","statement":"x"}]}',
    ]);
    expect(r.exitCode).toBe(0);
    expect(output(r)).toContain("wrote acceptance-contract");

    const read = runCli(root, ["artifact", "read", "GXPM-20", "acceptance-contract"]);
    expect(output(read)).toContain('"AC-1"');
  });

  test("writes artifact from --from <file>", async () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-art-write-file-"));
    expect(runCli(root, ["issue", "create", "GXPM-21"]).exitCode).toBe(0);
    const fixturePath = join(root, "payload.json");
    await Bun.write(fixturePath, '{"summary":"from file"}');

    const r = runCli(root, [
      "artifact", "write", "GXPM-21", "triage-report",
      "--from", fixturePath,
    ]);
    expect(r.exitCode).toBe(0);

    const read = runCli(root, ["artifact", "read", "GXPM-21", "triage-report"]);
    expect(output(read)).toContain('"from file"');
  });

  test("rejects invalid artifact type", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-art-write-bad-"));
    expect(runCli(root, ["issue", "create", "GXPM-22"]).exitCode).toBe(0);

    const r = runCli(root, [
      "artifact", "write", "GXPM-22", "unknown-type",
      "--json", "{}",
    ]);
    expect(r.exitCode).toBe(1);
    expect(output(r)).toContain("Invalid artifact type");
  });

  test("rejects malformed JSON payload", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-art-write-malformed-"));
    expect(runCli(root, ["issue", "create", "GXPM-23"]).exitCode).toBe(0);

    const r = runCli(root, [
      "artifact", "write", "GXPM-23", "acceptance-contract",
      "--json", "{not json",
    ]);
    expect(r.exitCode).toBe(1);
    expect(output(r)).toContain("invalid JSON");
  });

  test("requires one of --json / --from / --stdin", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-art-write-noinput-"));
    expect(runCli(root, ["issue", "create", "GXPM-24"]).exitCode).toBe(0);

    const r = runCli(root, ["artifact", "write", "GXPM-24", "acceptance-contract"]);
    expect(r.exitCode).toBe(1);
    expect(output(r)).toContain("--json");
  });
});

describe("gxpm artifact edit CLI", () => {
  test("with EDITOR=true (no-op) preserves payload", async () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-art-edit-noop-"));
    expect(runCli(root, ["issue", "create", "GXPM-40"]).exitCode).toBe(0);
    expect(runCli(root, ["triage", "init", "GXPM-40"]).exitCode).toBe(0);

    // EDITOR=true exits 0 without modifying the file
    const result = Bun.spawnSync({
      cmd: ["bun", "run", cliPath, "artifact", "edit", "GXPM-40", "acceptance-contract"],
      cwd: root,
      env: { ...process.env, EDITOR: "true" },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).toBe(0);

    const read = runCli(root, ["artifact", "read", "GXPM-40", "acceptance-contract"]);
    expect(read.exitCode).toBe(0);
    // Original draft payload still intact
    expect(output(read)).toContain('"acceptance-contract"');
  });

  test("with EDITOR replacing content updates payload", async () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-art-edit-replace-"));
    expect(runCli(root, ["issue", "create", "GXPM-41"]).exitCode).toBe(0);

    // fake editor: writes new JSON to the file
    const fakeEditor = join(root, "fake-editor.sh");
    await Bun.write(fakeEditor, '#!/bin/bash\necho \'{"replaced":true}\' > "$1"\n');
    Bun.spawnSync({ cmd: ["chmod", "+x", fakeEditor] });

    const result = Bun.spawnSync({
      cmd: ["bun", "run", cliPath, "artifact", "edit", "GXPM-41", "issue-intake"],
      cwd: root,
      env: { ...process.env, EDITOR: fakeEditor },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).toBe(0);

    const read = runCli(root, ["artifact", "read", "GXPM-41", "issue-intake"]);
    expect(output(read)).toContain('"replaced": true');
  });

  test("rejects invalid JSON saved by editor and preserves tempfile", async () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-art-edit-bad-"));
    expect(runCli(root, ["issue", "create", "GXPM-42"]).exitCode).toBe(0);

    const fakeEditor = join(root, "fake-bad-editor.sh");
    await Bun.write(fakeEditor, '#!/bin/bash\necho "not json" > "$1"\n');
    Bun.spawnSync({ cmd: ["chmod", "+x", fakeEditor] });

    const result = Bun.spawnSync({
      cmd: ["bun", "run", cliPath, "artifact", "edit", "GXPM-42", "issue-intake"],
      cwd: root,
      env: { ...process.env, EDITOR: fakeEditor },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("invalid JSON");
  });
});

describe("gxpm wiki CLI", () => {
  test("reports absent Qoder wiki as optional", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-wiki-cli-absent-"));

    const r = runCli(root, ["wiki", "status"]);

    expect(r.exitCode).toBe(0);
    expect(output(r)).toContain("Qoder wiki: not detected");
    expect(output(r)).toContain("Normal gxpm workflow continues");
  });

  test("prints Qoder wiki status as JSON when present", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-wiki-cli-present-"));
    const page = join(root, ".qoder", "repowiki", "en", "content", "Overview.md");
    mkdirSync(dirname(page), { recursive: true });
    writeFileSync(page, "# Overview\n\n[state](file://core/state.ts#L1)\n");

    const r = runCli(root, ["wiki", "status", "--json"]);

    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(output(r));
    expect(parsed.detected).toBe(true);
    expect(parsed.pageCount).toBe(1);
    expect(parsed.topPages[0].citedFiles).toContain("core/state.ts");
  });

  test("records manual sync and reminder evidence", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-wiki-cli-mark-"));

    const sync = runCli(root, ["wiki", "mark-sync", "--note", "manual sync"]);
    expect(sync.exitCode).toBe(0);
    expect(output(sync)).toContain("recorded Qoder wiki manual sync");

    const reminder = runCli(root, ["wiki", "mark-reminder", "--note", "session reminder"]);
    expect(reminder.exitCode).toBe(0);
    expect(output(reminder)).toContain("recorded Qoder wiki reminder");

    const stored = JSON.parse(readFileSync(join(root, ".gxpm", "wiki", "qoder.json"), "utf8"));
    expect(stored.lastSyncAt).toBeTruthy();
    expect(stored.lastReminderAt).toBeTruthy();
    expect(stored.note).toBe("session reminder");
  });

  test("prints native wiki context for an issue and can persist it as an artifact", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-wiki-cli-context-"));
    const source = join(root, "core", "phase-gates.ts");
    mkdirSync(dirname(source), { recursive: true });
    writeFileSync(source, "export const PHASE_GATE_RULES = [];\n");
    expect(runCli(root, ["issue", "create", "GXPM-91"]).exitCode).toBe(0);
    expect(
      runCli(root, [
        "artifact",
        "write",
        "GXPM-91",
        "issue-intake",
        "--json",
        JSON.stringify({ summary: "Need phase gate context for implementation." }),
      ]).exitCode,
    ).toBe(0);
    expect(runCli(root, ["wiki", "init"]).exitCode).toBe(0);

    const context = runCli(root, ["wiki", "context", "GXPM-91", "--limit", "2", "--write-artifact", "--json"]);

    expect(context.exitCode).toBe(0);
    const parsed = JSON.parse(output(context));
    expect(parsed.contextFiles).toContain("core/phase-gates.ts");
    expect(parsed.artifactWritten).toBe("wiki-context");
    const stored = JSON.parse(readFileSync(join(root, ".gxpm", "issues", "GXPM-91", "artifacts", "wiki-context.json"), "utf8"));
    expect(stored.payload.contextFiles).toContain("core/phase-gates.ts");

    const phaseOverride = runCli(root, ["wiki", "context", "GXPM-91", "--phase", "plan", "--limit", "2", "--json"]);
    expect(phaseOverride.exitCode).toBe(0);
    expect(JSON.parse(output(phaseOverride)).phase).toBe("plan");

    const invalidPhase = runCli(root, ["wiki", "context", "GXPM-91", "--phase", "INVALID_PHASE", "--json"]);
    expect(invalidPhase.exitCode).toBe(1);
    expect(output(invalidPhase)).toContain("Invalid phase: INVALID_PHASE");
  });

  test("rejects extra positional tokens for native wiki context", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-wiki-cli-context-extra-"));
    expect(runCli(root, ["issue", "create", "GXPM-92"]).exitCode).toBe(0);
    expect(runCli(root, ["wiki", "init"]).exitCode).toBe(0);

    const context = runCli(root, ["wiki", "context", "GXPM-92", "extra-token", "--json"]);

    expect(context.exitCode).toBe(1);
    expect(output(context)).toContain("Usage: gxpm wiki context <issue-id>");

    const unknownFlag = runCli(root, ["wiki", "context", "GXPM-92", "--wirte-artifact", "--json"]);
    expect(unknownFlag.exitCode).toBe(1);
    expect(output(unknownFlag)).toContain("Unknown option for gxpm wiki context: --wirte-artifact");
  });
});

describe("gxpm issue checkpoint/resume CLI", () => {
  test("saves checkpoint JSON from stdin and prints it through resume", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-cli-checkpoint-"));
    expect(runCli(root, ["issue", "create", "GXPM-70"]).exitCode).toBe(0);

    const checkpoint = runCliWithInput(
      root,
      ["issue", "checkpoint", "GXPM-70", "--title", "fresh handoff", "--stdin"],
      JSON.stringify({
        summary: "Fresh sessions should resume from issue memory.",
        decisions: ["Keep checkpoint truth under .gxpm."],
        remainingWork: ["Run the next implementation step."],
        notes: ["No gstack runtime dependency."],
      }),
    );

    expect(checkpoint.exitCode).toBe(0);
    expect(output(checkpoint)).toContain("checkpoint saved for GXPM-70");
    expect(output(checkpoint)).toContain("resume-packet.json");

    const resume = runCli(root, ["issue", "resume", "GXPM-70"]);
    expect(resume.exitCode).toBe(0);
    const out = output(resume);
    expect(out).toContain("GXPM-70 resume packet");
    expect(out).toContain("phase: triage");
    expect(out).toContain("Fresh sessions should resume from issue memory.");
    expect(out).toContain("Run the next implementation step.");
    expect(out).toContain("Next: gxpm issue next GXPM-70");
  });

  test("resume explains how to create a checkpoint when none exists", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-cli-no-checkpoint-"));
    expect(runCli(root, ["issue", "create", "GXPM-71"]).exitCode).toBe(0);

    const resume = runCli(root, ["issue", "resume", "GXPM-71"]);

    expect(resume.exitCode).toBe(1);
    expect(output(resume)).toContain("No resume packet found for GXPM-71");
    expect(output(resume)).toContain("gxpm issue checkpoint GXPM-71");
  });
});
