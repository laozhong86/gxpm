import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { writeArtifact } from "../core/artifacts";
import { createIssueState } from "../core/state";
import {
  getNativeWikiContextForIssue,
  initializeNativeWiki,
  extractCitedFiles,
  getQoderWikiStatus,
  markQoderWikiReminder,
  markQoderWikiSync,
  queryNativeWiki,
  updateNativeWiki,
} from "../core/wiki";
import { output, runCli } from "./helpers/workflow";

function tempRoot() {
  const root = mkdtempSync(join(tmpdir(), "gxpm-wiki-"));
  createdRoots.push(root);
  return root;
}

const createdRoots: string[] = [];

afterEach(() => {
  for (const root of createdRoots) {
    rmSync(root, { recursive: true, force: true });
  }
  createdRoots.length = 0;
});

function writeWikiPage(root: string, relativePath: string, content: string) {
  const path = join(root, ".qoder", "repowiki", "en", "content", relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

describe("Qoder wiki capability", () => {
  test("is optional when .qoder/repowiki is absent", () => {
    const root = tempRoot();

    const status = getQoderWikiStatus({ root, now: new Date("2026-04-27T00:00:00Z") });

    expect(status.detected).toBe(false);
    expect(status.state).toBe("absent");
    expect(status.pageCount).toBe(0);
    expect(status.reminder.reminderDue).toBe(false);
    expect(status.progressiveRead[0]).toContain("continue normal gxpm workflow");
  });

  test("treats a non-directory .qoder/repowiki path as absent", () => {
    const root = tempRoot();
    mkdirSync(join(root, ".qoder"), { recursive: true });
    writeFileSync(join(root, ".qoder", "repowiki"), "not a directory");

    const status = getQoderWikiStatus({ root, now: new Date("2026-04-27T00:00:00Z") });

    expect(status.detected).toBe(false);
    expect(status.state).toBe("absent");
    expect(status.pageCount).toBe(0);
  });

  test("summarizes markdown pages without requiring metadata reads", () => {
    const root = tempRoot();
    writeWikiPage(
      root,
      "Overview.md",
      "# Project Overview\n\n<cite>[state](file://core/state.ts#L1-L20)</cite>\n",
    );
    writeWikiPage(root, "Nested/Config.md", "# Config\n\n[cfg](file://core/config.ts)\n");
    const metadataPath = join(root, ".qoder", "repowiki", "en", "meta", "repowiki-metadata.json");
    mkdirSync(dirname(metadataPath), { recursive: true });
    writeFileSync(metadataPath, JSON.stringify({ huge: "metadata should not be surfaced" }));

    const status = getQoderWikiStatus({ root, now: new Date("2026-04-27T00:00:00Z") });

    expect(status.detected).toBe(true);
    expect(status.state).toBe("present");
    expect(status.contentRoots).toEqual([".qoder/repowiki/en/content"]);
    expect(status.pageCount).toBe(2);
    expect(status.topPages[0].path).toBe(".qoder/repowiki/en/content/Overview.md");
    expect(status.topPages[0].citedFiles).toContain("core/state.ts");
    expect(JSON.stringify(status)).not.toContain("metadata should not be surfaced");
  });

  test("does not traverse nested content roots twice", () => {
    const root = tempRoot();
    writeWikiPage(root, "Overview.md", "# Overview\n");
    writeWikiPage(root, "generated/content/Deep.md", "# Deep\n");

    const status = getQoderWikiStatus({ root, now: new Date("2026-04-27T00:00:00Z") });

    expect(status.contentRoots).toEqual([".qoder/repowiki/en/content"]);
    expect(status.pageCount).toBe(2);
    expect(status.topPages.map((page) => page.path).sort()).toEqual([
      ".qoder/repowiki/en/content/Overview.md",
      ".qoder/repowiki/en/content/generated/content/Deep.md",
    ]);
  });

  test("extracts cited source files from wiki markdown", () => {
    expect(
      extractCitedFiles(
        "[a](file://core/state.ts#L1-L10)\n[b](file://scripts/gxpm.ts)\n[c](file://core/state.ts#L2)",
      ),
    ).toEqual(["core/state.ts", "scripts/gxpm.ts"]);
  });

  test("degrades safely when a wiki content directory is unreadable", () => {
    const root = tempRoot();
    const contentRoot = join(root, ".qoder", "repowiki", "en", "content");
    mkdirSync(contentRoot, { recursive: true });
    chmodSync(contentRoot, 0o000);

    try {
      const status = getQoderWikiStatus({ root, now: new Date("2026-04-27T00:00:00Z") });
      expect(status.detected).toBe(true);
      expect(["empty", "present"]).toContain(status.state);
    } finally {
      chmodSync(contentRoot, 0o700);
    }
  });

  test("tracks weekly sync and reminder evidence explicitly", () => {
    const root = tempRoot();
    writeWikiPage(root, "Overview.md", "# Overview\n");

    const first = getQoderWikiStatus({ root, now: new Date("2026-04-27T00:00:00Z") });
    expect(first.reminder.syncStale).toBe(true);
    expect(first.reminder.reminderDue).toBe(true);

    markQoderWikiReminder({
      root,
      now: new Date("2026-04-27T01:00:00Z"),
      note: "session-start reminder",
    });
    const afterReminder = getQoderWikiStatus({ root, now: new Date("2026-04-28T00:00:00Z") });
    expect(afterReminder.reminder.syncStale).toBe(true);
    expect(afterReminder.reminder.reminderDue).toBe(false);

    markQoderWikiSync({
      root,
      now: new Date("2026-04-28T01:00:00Z"),
      note: "manual qoder sync",
    });
    const statePath = join(root, ".gxpm", "wiki", "qoder.json");
    expect(existsSync(statePath)).toBe(true);
    expect(readFileSync(statePath, "utf8")).toContain("manual qoder sync");

    const afterSync = getQoderWikiStatus({ root, now: new Date("2026-04-29T00:00:00Z") });
    expect(afterSync.reminder.syncStale).toBe(false);
    expect(afterSync.reminder.reminderDue).toBe(false);
  });

  test("marks sync stale when observed wiki metadata is newer than the last sync", () => {
    const root = tempRoot();
    writeWikiPage(root, "Overview.md", "# Overview\n");
    const metadataPath = join(root, ".qoder", "repowiki", "en", "meta", "repowiki-metadata.json");
    mkdirSync(dirname(metadataPath), { recursive: true });
    writeFileSync(metadataPath, "{}");
    utimesSync(metadataPath, new Date("2026-04-29T02:00:00Z"), new Date("2026-04-29T02:00:00Z"));

    markQoderWikiSync({
      root,
      now: new Date("2026-04-28T01:00:00Z"),
      note: "manual qoder sync",
    });

    const status = getQoderWikiStatus({ root, now: new Date("2026-04-29T03:00:00Z") });

    expect(status.reminder.syncStale).toBe(true);
    expect(status.reminder.reminderDue).toBe(true);
    expect(status.reminder.reason).toContain("updated since the last manual sync");
  });

  test("re-arms reminders when observed wiki metadata changes after the last reminder", () => {
    const root = tempRoot();
    writeWikiPage(root, "Overview.md", "# Overview\n");
    const metadataPath = join(root, ".qoder", "repowiki", "en", "meta", "repowiki-metadata.json");
    mkdirSync(dirname(metadataPath), { recursive: true });
    writeFileSync(metadataPath, "{}");
    utimesSync(metadataPath, new Date("2026-04-29T02:00:00Z"), new Date("2026-04-29T02:00:00Z"));

    markQoderWikiSync({
      root,
      now: new Date("2026-04-28T01:00:00Z"),
      note: "manual qoder sync",
    });
    markQoderWikiReminder({
      root,
      now: new Date("2026-04-29T01:00:00Z"),
      note: "recent reminder before qoder changed",
    });

    const status = getQoderWikiStatus({ root, now: new Date("2026-04-29T03:00:00Z") });

    expect(status.reminder.syncStale).toBe(true);
    expect(status.reminder.reminderDue).toBe(true);
    expect(status.reminder.reason).toContain("updated since the last manual sync");
  });

  test("preserves epoch metadata timestamps as observed wiki updates", () => {
    const root = tempRoot();
    writeWikiPage(root, "Overview.md", "# Overview\n");
    const metadataPath = join(root, ".qoder", "repowiki", "en", "meta", "repowiki-metadata.json");
    mkdirSync(dirname(metadataPath), { recursive: true });
    writeFileSync(metadataPath, "{}");
    utimesSync(metadataPath, new Date(0), new Date(0));

    const status = getQoderWikiStatus({ root, now: new Date("2026-04-29T03:00:00Z") });

    expect(status.observedWikiUpdatedAt).toBe("1970-01-01T00:00:00.000Z");
  });

  test("keeps Qoder wiki record canonical fields when updating stale state", () => {
    const root = tempRoot();
    const statePath = join(root, ".gxpm", "wiki", "qoder.json");
    mkdirSync(dirname(statePath), { recursive: true });
    writeFileSync(
      statePath,
      JSON.stringify({
        schemaVersion: 99,
        provider: "other",
        repoWikiRoot: ".other/wiki",
      }),
    );

    markQoderWikiReminder({
      root,
      now: new Date("2026-04-29T01:00:00Z"),
      note: "reminder",
    });

    const record = JSON.parse(readFileSync(statePath, "utf8"));
    expect(record.schemaVersion).toBe(1);
    expect(record.provider).toBe("qoder");
    expect(record.repoWikiRoot).toBe(".qoder/repowiki");
  });
});

function writeRepoFile(root: string, relativePath: string, content: string) {
  const path = join(root, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

describe("gxpm-native wiki engine", () => {
  test("initializes a local wiki index, graph, docs, and state without Qoder", () => {
    const root = tempRoot();
    writeRepoFile(root, "core/state.ts", "export function transitionIssuePhase() {}\n");
    writeRepoFile(root, "scripts/gxpm.ts", 'import { transitionIssuePhase } from "../core/state";\n');
    writeRepoFile(root, "README.md", "# GXPM\n\nLocal project manager.\n");

    const result = initializeNativeWiki({ root, now: new Date("2026-04-29T00:00:00Z") });

    expect(result.provider).toBe("gxpm");
    expect(result.index.files.map((file) => file.path)).toContain("core/state.ts");
    expect(result.index.files.find((file) => file.path === "core/state.ts")?.exports).toContain(
      "transitionIssuePhase",
    );
    expect(result.graph.edges).toContainEqual({
      from: "scripts/gxpm.ts",
      to: "core/state.ts",
      kind: "imports",
    });
    expect(existsSync(join(root, ".gxpm", "wiki", "index", "files.json"))).toBe(true);
    expect(existsSync(join(root, ".gxpm", "wiki", "index", "graph.json"))).toBe(true);
    expect(readFileSync(join(root, ".gxpm", "wiki", "content", "Overview.md"), "utf8")).toContain(
      "file://core/state.ts",
    );
    expect(JSON.parse(readFileSync(join(root, ".gxpm", "wiki", "state.json"), "utf8"))).toMatchObject({
      provider: "gxpm",
      status: "idle",
      indexPath: ".gxpm/wiki/index/files.json",
    });
  });

  test("queries native wiki docs and source files from the structured index", () => {
    const root = tempRoot();
    writeRepoFile(root, "core/phase-gates.ts", "export const PHASE_GATE_RULES = [];\n");
    writeRepoFile(root, "core/state.ts", 'import { PHASE_GATE_RULES } from "./phase-gates";\n');
    initializeNativeWiki({ root, now: new Date("2026-04-29T00:00:00Z") });

    const result = queryNativeWiki({ root, query: "phase gate rules", limit: 3 });

    expect(result.provider).toBe("gxpm");
    expect(result.results[0].path).toBe("core/phase-gates.ts");
    expect(result.results[0].source).toBe("file-index");
    expect(result.contextFiles).toContain("core/phase-gates.ts");
    expect(result.suggestedDocs).toContain(".gxpm/wiki/content/Overview.md");
  });

  test("builds issue context from issue state and artifacts", () => {
    const root = tempRoot();
    writeRepoFile(root, "core/phase-gates.ts", "export const PHASE_GATE_RULES = [];\n");
    writeRepoFile(root, "core/gate.ts", 'import { PHASE_GATE_RULES } from "./phase-gates";\n');
    createIssueState({ root, issueId: "GXPM-90" });
    writeArtifact({
      root,
      issueId: "GXPM-90",
      type: "issue-intake",
      payload: { summary: "Need phase gate context for workflow routing." },
    });
    writeArtifact({
      root,
      issueId: "GXPM-90",
      type: "wiki-context",
      payload: { summary: "Prior context output should not feed the next query." },
    });
    initializeNativeWiki({ root, now: new Date("2026-04-29T00:00:00Z") });

    const result = getNativeWikiContextForIssue({ root, issueId: "GXPM-90", limit: 2 });

    expect(result.issueId).toBe("GXPM-90");
    expect(result.phase).toBe("triage");
    expect(result.artifactsUsed.map((artifact) => artifact.type)).toContain("issue-intake");
    expect(result.artifactsUsed.map((artifact) => artifact.type)).not.toContain("wiki-context");
    expect(result.contextFiles).toContain("core/phase-gates.ts");
    expect(result.suggestedDocs).toContain(".gxpm/wiki/content/Overview.md");
  });

  test("updates the native wiki after repository files change", () => {
    const root = tempRoot();
    writeRepoFile(root, "core/state.ts", "export function readIssueState() {}\n");
    initializeNativeWiki({ root, now: new Date("2026-04-29T00:00:00Z") });
    writeRepoFile(root, "core/wiki-query.ts", "export function queryNativeWiki() {}\n");

    const result = updateNativeWiki({ root, now: new Date("2026-04-29T01:00:00Z") });

    expect(result.state.generatedAt).toBe("2026-04-29T01:00:00.000Z");
    expect(result.index.files.map((file) => file.path)).toContain("core/wiki-query.ts");
    expect(result.state.status).toBe("idle");
  });
});

describe("gxpm native wiki CLI", () => {
  test("supports init, query, and update commands", () => {
    const root = tempRoot();
    writeRepoFile(root, "core/state.ts", "export function transitionIssuePhase() {}\n");

    const init = runCli(root, ["wiki", "init", "--json"]);
    expect(init.exitCode).toBe(0);
    expect(JSON.parse(output(init))).toMatchObject({ provider: "gxpm" });

    const query = runCli(root, ["wiki", "query", "transition phase", "--json"]);
    expect(query.exitCode).toBe(0);
    expect(JSON.parse(output(query)).contextFiles).toContain("core/state.ts");

    writeRepoFile(root, "core/wiki.ts", "export function initializeNativeWiki() {}\n");
    const update = runCli(root, ["wiki", "update", "--json"]);
    expect(update.exitCode).toBe(0);
    expect(JSON.parse(output(update)).index.files.map((file: { path: string }) => file.path)).toContain(
      "core/wiki.ts",
    );
  });
});
