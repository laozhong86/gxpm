import { afterEach, describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
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
  getNativeWikiStatus,
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

function git(root: string, args: string) {
  return execSync(`git ${args}`, { cwd: root, stdio: "pipe" }).toString().trim();
}

function initGitRepo(root: string) {
  git(root, "init -b main");
  git(root, "config user.email test@example.com");
  git(root, "config user.name 'Test User'");
}

function commitAll(root: string, message: string) {
  git(root, "add .");
  git(root, `commit -m '${message}'`);
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
    expect(result.dimensions.files.map((file) => file.path)).toContain("core/state.ts");
    expect(existsSync(join(root, ".gxpm", "wiki", "index", "files.json"))).toBe(true);
    expect(existsSync(join(root, ".gxpm", "wiki", "index", "graph.json"))).toBe(true);
    expect(existsSync(join(root, ".gxpm", "wiki", "index", "dimensions.json"))).toBe(true);
    expect(existsSync(join(root, ".gxpm", "wiki", "content", "Project-Topics.md"))).toBe(true);
    expect(readFileSync(join(root, ".gxpm", "wiki", "content", "Overview.md"), "utf8")).toContain(
      "file://core/state.ts",
    );
    expect(JSON.parse(readFileSync(join(root, ".gxpm", "wiki", "state.json"), "utf8"))).toMatchObject({
      provider: "gxpm",
      status: "idle",
      indexPath: ".gxpm/wiki/index/files.json",
      dimensionsPath: ".gxpm/wiki/index/dimensions.json",
    });
  });

  test("generates deterministic file dimensions for taxonomy planning", () => {
    const root = tempRoot();
    writeRepoFile(root, "README.md", "# GXPM\n\n## Quick Start\n");
    writeRepoFile(root, "core/state.ts", "export function transitionIssuePhase() {}\n");
    writeRepoFile(root, "core/config.ts", "export const CONFIG_REGISTRY = {};\n");
    writeRepoFile(
      root,
      "scripts/gxpm.ts",
      'import { transitionIssuePhase } from "../core/state";\nconsole.log("gxpm wiki status");\n',
    );
    writeRepoFile(root, ".githooks/pre-commit", "#!/bin/sh\n# gxpm hook\n");
    writeRepoFile(root, "test/wiki.test.ts", "import { describe, test } from 'bun:test';\ndescribe('wiki', () => test('works', () => {}));\n");

    const result = initializeNativeWiki({ root, now: new Date("2026-04-29T00:00:00Z") });
    const dimensions = JSON.parse(readFileSync(join(root, ".gxpm", "wiki", "index", "dimensions.json"), "utf8"));
    const byPath = new Map(result.dimensions.files.map((file) => [file.path, file.dimensions]));

    expect(dimensions).toMatchObject({
      schemaVersion: 1,
      provider: "gxpm",
      generatedAt: "2026-04-29T00:00:00.000Z",
    });
    expect(dimensions.files.map((file: { path: string }) => file.path)).toEqual(result.index.files.map((file) => file.path));
    expect(byPath.get("README.md")?.docs).toContain("heading:GXPM");
    expect(byPath.get("core/state.ts")?.symbols).toContain("export:transitionIssuePhase");
    expect(byPath.get("scripts/gxpm.ts")?.apis).toContain("cli:gxpm wiki status");
    expect(byPath.get("scripts/gxpm.ts")?.relations).toContain("imports:core/state.ts");
    expect(byPath.get("core/config.ts")?.config).toContain("path:config");
    expect(byPath.get(".githooks/pre-commit")?.workflows).toContain("path:hook");
    expect(byPath.get("test/wiki.test.ts")?.tests).toContain("path:test");
  });

  test("generates topic docs with source anchors, markdown source lists, and a phase diagram", () => {
    const root = tempRoot();
    writeRepoFile(root, "core/state.ts", "export function transitionIssuePhase() {}\n");
    writeRepoFile(root, "core/phase-gates.ts", `${Array.from({ length: 120 }, (_, index) => `// gate ${index + 1}`).join("\n")}\n`);
    writeRepoFile(root, "core/artifacts.ts", "export function writeArtifact() {}\n");
    writeRepoFile(root, "core/config.ts", "export function readGxpmConfig() {}\n");
    writeRepoFile(root, "core/wiki.ts", "export function initializeNativeWiki() {}\n");
    writeRepoFile(root, "scripts/gxpm.ts", 'import { initializeNativeWiki } from "../core/wiki";\n');
    writeRepoFile(root, ".githooks/pre-commit", "#!/bin/sh\n");

    const result = initializeNativeWiki({ root, now: new Date("2026-04-29T00:00:00Z") });

    expect(result.docs).toContain(".gxpm/wiki/content/Project-Topics.md");
    expect(result.docs).toContain(".gxpm/wiki/content/Phase-Lifecycle.md");
    expect(result.docs).toContain(".gxpm/wiki/content/Artifact-System.md");
    expect(result.docs).toContain(".gxpm/wiki/content/Hook-Governance.md");
    expect(result.docs).toContain(".gxpm/wiki/content/Config-Worktree.md");
    expect(result.docs).toContain(".gxpm/wiki/content/Native-Wiki.md");
    expect(result.docs).toContain(".gxpm/wiki/content/CLI-Surface.md");

    const phaseDoc = readFileSync(join(root, ".gxpm", "wiki", "content", "Phase-Lifecycle.md"), "utf8");
    expect(phaseDoc).toContain("## Sources");
    expect(phaseDoc).toContain("- [core/phase-gates.ts](file://core/phase-gates.ts#L1-L120)");
    expect(phaseDoc).not.toContain("<cite>");
    expect(phaseDoc).toContain("file://core/phase-gates.ts#L1-L120");
    expect(phaseDoc).toContain("```mermaid");
    expect(phaseDoc).toContain("triage --> plan");

    const wikiDoc = readFileSync(join(root, ".gxpm", "wiki", "content", "Native-Wiki.md"), "utf8");
    expect(wikiDoc).toContain("file://core/wiki.ts#L");
  });

  test("generates a project-derived topic map from native dimensions", () => {
    const root = tempRoot();
    writeRepoFile(root, "core/phase-gates.ts", "export const PHASE_GATE_RULES = [];\n");
    writeRepoFile(root, "scripts/gxpm.ts", "console.log('gxpm wiki status');\n");
    writeRepoFile(root, "hosts/codex.ts", "export function installCodexAdapter() {}\n");
    writeRepoFile(root, "docs/architecture/overview.md", "# Architecture\n");
    writeRepoFile(root, "test/wiki.test.ts", "import { describe, test } from 'bun:test';\ndescribe('wiki', () => test('works', () => {}));\n");

    initializeNativeWiki({ root, now: new Date("2026-04-29T00:00:00Z") });

    const topicMap = readFileSync(join(root, ".gxpm", "wiki", "content", "Project-Topics.md"), "utf8");
    expect(topicMap).toContain("# Project Topics");
    expect(topicMap).toContain("Project-derived navigation generated from gxpm native dimensions");
    expect(topicMap).toContain("### Phase And Gate System");
    expect(topicMap).toContain("[core/phase-gates.ts](file://core/phase-gates.ts#L1-L1)");
    expect(topicMap).toContain("### CLI Command Surface");
    expect(topicMap).toContain("[scripts/gxpm.ts](file://scripts/gxpm.ts#L1-L1)");
    expect(topicMap).toContain("### Host Adapters");
    expect(topicMap).toContain("[hosts/codex.ts](file://hosts/codex.ts#L1-L1)");
    expect(topicMap).toContain("### Tests And Verification");
    expect(topicMap).toContain("## Top Dimension Signals");
    expect(topicMap).toContain("## Import Hubs");
  });

  test("escapes generated topic source links while preserving cited file extraction", () => {
    const root = tempRoot();
    writeRepoFile(root, ".githooks/branch guard (draft)", "#!/bin/sh\n");

    initializeNativeWiki({ root, now: new Date("2026-04-29T00:00:00Z") });

    const hookDoc = readFileSync(join(root, ".gxpm", "wiki", "content", "Hook-Governance.md"), "utf8");
    expect(hookDoc).toContain("file://.githooks/branch%20guard%20%28draft%29#L1-L1");
    expect(extractCitedFiles(hookDoc)).toContain(".githooks/branch guard (draft)");
  });

  test("escapes generated file links in indexes, graphs, and related imports", () => {
    const root = tempRoot();
    writeRepoFile(
      root,
      "core/wiki.ts",
      'import { sourceDraft } from "./source (draft)";\nexport function initializeNativeWiki() {}\n',
    );
    writeRepoFile(root, "core/source (draft).ts", "export function sourceDraft() {}\n");

    initializeNativeWiki({ root, now: new Date("2026-04-29T00:00:00Z") });

    const encoded = "file://core/source%20%28draft%29.ts";
    const overview = readFileSync(join(root, ".gxpm", "wiki", "content", "Overview.md"), "utf8");
    const fileIndex = readFileSync(join(root, ".gxpm", "wiki", "content", "File-Index.md"), "utf8");
    const codeGraph = readFileSync(join(root, ".gxpm", "wiki", "content", "Code-Graph.md"), "utf8");
    const wikiDoc = readFileSync(join(root, ".gxpm", "wiki", "content", "Native-Wiki.md"), "utf8");
    expect(overview).toContain(`[core/source (draft).ts](${encoded})`);
    expect(fileIndex).toContain(`[core/source (draft).ts](${encoded})`);
    expect(codeGraph).toContain(`[core/source (draft).ts](${encoded})`);
    expect(wikiDoc).toContain(`[core/source (draft).ts](${encoded})`);
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

  test("suggests relevant topic docs before generic wiki pages", () => {
    const root = tempRoot();
    writeRepoFile(root, "core/phase-gates.ts", "export const PHASE_GATE_RULES = [];\n");
    writeRepoFile(root, "core/wiki.ts", "export function initializeNativeWiki() {}\nexport function getQoderWikiStatus() {}\n");
    initializeNativeWiki({ root, now: new Date("2026-04-29T00:00:00Z") });

    const phase = queryNativeWiki({ root, query: "phase gate transition artifacts", limit: 3 });
    expect(phase.contextFiles).toContain("core/phase-gates.ts");
    expect(phase.suggestedDocs[0]).toBe(".gxpm/wiki/content/Phase-Lifecycle.md");
    expect(phase.suggestedDocs).toContain(".gxpm/wiki/content/Overview.md");

    const hyphenatedPhase = queryNativeWiki({ root, query: "phase-lifecycle", limit: 3 });
    expect(hyphenatedPhase.suggestedDocs[0]).toBe(".gxpm/wiki/content/Phase-Lifecycle.md");

    const wiki = queryNativeWiki({ root, query: "qoder native wiki initialization update", limit: 3 });
    expect(wiki.contextFiles).toContain("core/wiki.ts");
    expect(wiki.suggestedDocs[0]).toBe(".gxpm/wiki/content/Native-Wiki.md");
  });

  test("suggests the project topic map before generic index docs for inferred topics", () => {
    const root = tempRoot();
    writeRepoFile(root, "hosts/codex.ts", "export function installCodexAdapter() {}\n");
    writeRepoFile(root, "core/state.ts", "export function readIssueState() {}\n");
    initializeNativeWiki({ root, now: new Date("2026-04-29T00:00:00Z") });

    const result = queryNativeWiki({ root, query: "hosts codex adapter", limit: 3 });

    expect(result.contextFiles).toContain("hosts/codex.ts");
    const projectTopics = result.suggestedDocs.indexOf(".gxpm/wiki/content/Project-Topics.md");
    const hookGovernance = result.suggestedDocs.indexOf(".gxpm/wiki/content/Hook-Governance.md");
    const fileIndex = result.suggestedDocs.indexOf(".gxpm/wiki/content/File-Index.md");
    const codeGraph = result.suggestedDocs.indexOf(".gxpm/wiki/content/Code-Graph.md");
    expect(projectTopics).toBeGreaterThanOrEqual(0);
    expect(hookGovernance === -1 || projectTopics < hookGovernance).toBe(true);
    expect(fileIndex === -1 || projectTopics < fileIndex).toBe(true);
    expect(codeGraph === -1 || projectTopics < codeGraph).toBe(true);
  });

  test("keeps generated topic doc table cells on one markdown row", () => {
    const root = tempRoot();
    writeRepoFile(root, "core/wiki.ts", "export function initializeNativeWiki() {}\n");
    writeRepoFile(root, "docs/governance/development-contract.md", "# Native | Wiki\r\n");

    initializeNativeWiki({ root, now: new Date("2026-04-29T00:00:00Z") });

    const wikiDoc = readFileSync(join(root, ".gxpm", "wiki", "content", "Native-Wiki.md"), "utf8");
    expect(wikiDoc).toContain("Native \\| Wiki");
    expect(wikiDoc).not.toContain("\r");
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

  test("builds issue context when legacy issue artifact index is missing", () => {
    const root = tempRoot();
    writeRepoFile(root, "core/wiki.ts", "export function getNativeWikiContextForIssue() {}\n");
    createIssueState({ root, issueId: "GXPM-92" });
    rmSync(join(root, ".gxpm", "issues", "GXPM-92", "artifacts", "index.json"), { force: true });
    initializeNativeWiki({ root, now: new Date("2026-04-29T00:00:00Z") });

    const result = getNativeWikiContextForIssue({ root, issueId: "GXPM-92", limit: 2 });

    expect(result.issueId).toBe("GXPM-92");
    expect(result.artifactsUsed).toEqual([]);
  });

  test("updates the native wiki after repository files change", () => {
    const root = tempRoot();
    writeRepoFile(root, "core/state.ts", "export function readIssueState() {}\n");
    initializeNativeWiki({ root, now: new Date("2026-04-29T00:00:00Z") });
    writeRepoFile(root, "core/wiki-query.ts", "export function queryNativeWiki() {}\n");

    const result = updateNativeWiki({ root, now: new Date("2026-04-29T01:00:00Z") });

    expect(result.state.generatedAt).toBe("2026-04-29T01:00:00.000Z");
    expect(result.index.files.map((file) => file.path)).toContain("core/wiki-query.ts");
    expect(result.dimensions.files.map((file) => file.path)).toContain("core/wiki-query.ts");
    expect(result.state.status).toBe("idle");
  });

  test("prunes stale generated native wiki docs on update", () => {
    const root = tempRoot();
    writeRepoFile(root, "core/wiki.ts", "export function initializeNativeWiki() {}\n");
    const result = initializeNativeWiki({ root, now: new Date("2026-04-29T00:00:00Z") });
    writeRepoFile(
      root,
      ".gxpm/wiki/content/generated-docs.json",
      JSON.stringify({ docs: [...result.docs, ".gxpm/wiki/content/Removed-Topic.md"] }, null, 2),
    );
    writeRepoFile(root, ".gxpm/wiki/content/Removed-Topic.md", "# stale generated topic\n");
    writeRepoFile(root, ".gxpm/wiki/content/Hand-Written.md", "# hand written topic\n");

    updateNativeWiki({ root, now: new Date("2026-04-29T01:00:00Z") });

    expect(existsSync(join(root, ".gxpm", "wiki", "content", "Removed-Topic.md"))).toBe(false);
    expect(existsSync(join(root, ".gxpm", "wiki", "content", "Hand-Written.md"))).toBe(true);
  });

  test("indexes git-tracked files and excludes ignored or untracked local files", () => {
    const root = tempRoot();
    initGitRepo(root);
    writeRepoFile(root, ".gitignore", ".codex/\n.claude/\n.gxpm/\n.qoder/\n");
    writeRepoFile(root, "README.md", "# GXPM\n");
    writeRepoFile(root, "bin/gxpm", "#!/usr/bin/env bun\nconsole.log('gxpm');\n");
    writeRepoFile(root, "core/state.ts", "export function readIssueState() {}\n");
    writeFileSync(join(root, "opaque-binary"), Buffer.from([0, 1, 2, 3]));
    writeRepoFile(root, ".codex/config.toml", "model = 'local'\n");
    writeRepoFile(root, ".claude/settings.local.json", "{}\n");
    writeRepoFile(root, ".gxpm/local/state.md", "# local gxpm state\n");
    writeRepoFile(root, ".qoder/repowiki/en/content/Generated.md", "# generated qoder page\n");
    writeRepoFile(root, "docs/scratch.md", "# local scratch\n");
    git(root, "add .gitignore README.md bin/gxpm core/state.ts opaque-binary");
    git(root, "add -f .codex/config.toml .claude/settings.local.json .gxpm/local/state.md .qoder/repowiki/en/content/Generated.md");
    git(root, "commit -m 'initial tracked files'");

    const result = initializeNativeWiki({ root, now: new Date("2026-04-29T00:00:00Z") });
    const paths = result.index.files.map((file) => file.path);

    expect(paths).toContain("README.md");
    expect(paths).toContain("bin/gxpm");
    expect(paths).toContain("core/state.ts");
    expect(paths).not.toContain("opaque-binary");
    expect(paths).not.toContain(".codex/config.toml");
    expect(paths).not.toContain(".claude/settings.local.json");
    expect(paths).not.toContain(".gxpm/local/state.md");
    expect(paths).not.toContain(".qoder/repowiki/en/content/Generated.md");
    expect(paths).not.toContain("docs/scratch.md");
  });

  test("reports native wiki status as current, then stale when HEAD advances", () => {
    const root = tempRoot();
    initGitRepo(root);
    writeRepoFile(root, "core/state.ts", "export function readIssueState() {}\n");
    commitAll(root, "initial state");
    initializeNativeWiki({ root, now: new Date("2026-04-29T00:00:00Z") });

    const current = getNativeWikiStatus({ root, now: new Date("2026-04-29T00:05:00Z") });
    expect(current.detected).toBe(true);
    expect(current.state).toBe("current");
    expect(current.stale).toBe(false);
    expect(current.indexedFiles).toBe(1);

    writeRepoFile(root, "core/wiki.ts", "export function updateNativeWiki() {}\n");
    commitAll(root, "add wiki module");
    const stale = getNativeWikiStatus({ root, now: new Date("2026-04-29T01:00:00Z") });
    expect(stale.state).toBe("stale");
    expect(stale.stale).toBe(true);
    expect(stale.reason).toContain("baseCommit differs from current HEAD");
    expect(stale.commands.update).toBe("gxpm wiki update");
  });

  test("reports native wiki stale when an indexed tracked file changes after generation", () => {
    const root = tempRoot();
    initGitRepo(root);
    writeRepoFile(root, "core/state.ts", "export function readIssueState() {}\n");
    commitAll(root, "initial state");
    initializeNativeWiki({ root, now: new Date("2026-04-29T00:00:00Z") });
    writeRepoFile(root, "core/state.ts", "export function readIssueState() {}\nexport function writeIssueState() {}\n");
    utimesSync(join(root, "core", "state.ts"), new Date("2026-04-29T01:00:00Z"), new Date("2026-04-29T01:00:00Z"));

    const stale = getNativeWikiStatus({ root, now: new Date("2026-04-29T01:05:00Z") });

    expect(stale.state).toBe("stale");
    expect(stale.stale).toBe(true);
    expect(stale.reason).toContain("tracked files changed after generation");
    expect(stale.changedFiles).toEqual(["core/state.ts"]);
  });

  test("reports partial native wiki artifacts as stale", () => {
    const missingIndexRoot = tempRoot();
    writeRepoFile(missingIndexRoot, "core/state.ts", "export function readIssueState() {}\n");
    initializeNativeWiki({ root: missingIndexRoot, now: new Date("2026-04-29T00:00:00Z") });
    rmSync(join(missingIndexRoot, ".gxpm", "wiki", "index", "files.json"), { force: true });

    const missingIndex = getNativeWikiStatus({ root: missingIndexRoot });
    expect(missingIndex.detected).toBe(true);
    expect(missingIndex.state).toBe("stale");
    expect(missingIndex.stale).toBe(true);
    expect(missingIndex.reason).toContain("index/files.json missing or unreadable");

    const missingGraphRoot = tempRoot();
    writeRepoFile(missingGraphRoot, "core/state.ts", "export function readIssueState() {}\n");
    initializeNativeWiki({ root: missingGraphRoot, now: new Date("2026-04-29T00:00:00Z") });
    rmSync(join(missingGraphRoot, ".gxpm", "wiki", "index", "graph.json"), { force: true });

    const missingGraph = getNativeWikiStatus({ root: missingGraphRoot });
    expect(missingGraph.detected).toBe(true);
    expect(missingGraph.state).toBe("stale");
    expect(missingGraph.stale).toBe(true);
    expect(missingGraph.reason).toContain("index/graph.json missing or unreadable");

    const missingDimensionsRoot = tempRoot();
    writeRepoFile(missingDimensionsRoot, "core/state.ts", "export function readIssueState() {}\n");
    initializeNativeWiki({ root: missingDimensionsRoot, now: new Date("2026-04-29T00:00:00Z") });
    rmSync(join(missingDimensionsRoot, ".gxpm", "wiki", "index", "dimensions.json"), { force: true });

    const missingDimensions = getNativeWikiStatus({ root: missingDimensionsRoot });
    expect(missingDimensions.detected).toBe(true);
    expect(missingDimensions.state).toBe("stale");
    expect(missingDimensions.stale).toBe(true);
    expect(missingDimensions.reason).toContain("index/dimensions.json missing or unreadable");

    const invalidDimensionsRoot = tempRoot();
    writeRepoFile(invalidDimensionsRoot, "core/state.ts", "export function readIssueState() {}\n");
    initializeNativeWiki({ root: invalidDimensionsRoot, now: new Date("2026-04-29T00:00:00Z") });
    writeFileSync(join(invalidDimensionsRoot, ".gxpm", "wiki", "index", "dimensions.json"), "{}\n");

    const invalidDimensions = getNativeWikiStatus({ root: invalidDimensionsRoot });
    expect(invalidDimensions.detected).toBe(true);
    expect(invalidDimensions.state).toBe("stale");
    expect(invalidDimensions.stale).toBe(true);
    expect(invalidDimensions.reason).toContain("index/dimensions.json missing or unreadable");
  });
});

describe("gxpm native wiki CLI", () => {
  test("supports init, query, and update commands", () => {
    const root = tempRoot();
    writeRepoFile(root, "core/state.ts", "export function transitionIssuePhase() {}\n");

    const init = runCli(root, ["wiki", "init", "--json"]);
    expect(init.exitCode).toBe(0);
    expect(JSON.parse(output(init))).toMatchObject({
      provider: "gxpm",
      state: { dimensionsPath: ".gxpm/wiki/index/dimensions.json" },
    });
    expect(JSON.parse(output(init)).dimensions.files.map((file: { path: string }) => file.path)).toContain(
      "core/state.ts",
    );

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
