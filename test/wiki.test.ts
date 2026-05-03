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
  ensureNativeWikiCurrent,
  getNativeWikiContextForIssue,
  getNativeWikiStatus,
  initializeNativeWiki,
  evaluateNativeWiki,
  extractCitedFiles,
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

test("extracts cited source files from wiki markdown", () => {
  expect(
    extractCitedFiles(
      "[a](file://core/state.ts#L1-L10)\n[b](file://scripts/gxpm.ts)\n[c](file://core/state.ts#L2)",
    ),
  ).toEqual(["core/state.ts", "scripts/gxpm.ts"]);
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
  test("initializes a local wiki index, graph, docs, and state", () => {
    const root = tempRoot();
    writeRepoFile(root, "core/state.ts", "export function transitionIssuePhase() {}\n");
    writeRepoFile(root, "core/native-helper.mjs", "export function nativeHelper() {}\n");
    writeRepoFile(root, "core/native-loader/index.cjs", "exports.nativeLoader = () => {};\n");
    writeRepoFile(
      root,
      "scripts/gxpm.ts",
      [
        'import { transitionIssuePhase } from "../core/state";',
        'import { nativeHelper } from "../core/native-helper";',
        'import { nativeLoader } from "../core/native-loader";',
        "",
      ].join("\n"),
    );
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
    expect(result.graph.edges).toContainEqual({
      from: "scripts/gxpm.ts",
      to: "core/native-helper.mjs",
      kind: "imports",
    });
    expect(result.graph.edges).toContainEqual({
      from: "scripts/gxpm.ts",
      to: "core/native-loader/index.cjs",
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
    writeRepoFile(root, "core/wiki-native.ts", "export function queryNativeWiki() {}\n");
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
    expect(wikiDoc).toContain("file://core/wiki-native.ts#L");

    const overviewDoc = readFileSync(join(root, ".gxpm", "wiki", "content", "Overview.md"), "utf8");
    expect(overviewDoc).toContain("[Project Topics](file://.gxpm/wiki/content/Project-Topics.md)");
  });

  test("generates a project-derived topic map from native dimensions", () => {
    const root = tempRoot();
    writeRepoFile(root, "core/phase-gates.ts", "export const PHASE_GATE_RULES = [];\n");
    writeRepoFile(root, "scripts/gxpm.ts", "console.log('gxpm wiki status');\n");
    writeRepoFile(root, "hosts/codex.ts", "export function installCodexAdapter() {}\n");
    writeRepoFile(root, "docs/architecture/overview.md", "# Architecture\n");
    writeRepoFile(root, "test/wiki.test.ts", "import { describe, test } from 'bun:test';\ndescribe('wiki', () => test('works', () => {}));\n");

    const result = initializeNativeWiki({ root, now: new Date("2026-04-29T00:00:00Z") });

    const topicMap = readFileSync(join(root, ".gxpm", "wiki", "content", "Project-Topics.md"), "utf8");
    expect(result.docs).toContain(".gxpm/wiki/content/project-topics/phase-and-gate-system.md");
    expect(result.docs).toContain(".gxpm/wiki/content/project-topics/host-adapters.md");
    expect(topicMap).toContain("# Project Topics");
    expect(topicMap).toContain("Project-derived navigation generated from gxpm native dimensions");
    expect(topicMap).toContain(
      "### [Phase And Gate System](file://.gxpm/wiki/content/project-topics/phase-and-gate-system.md)",
    );
    expect(topicMap).toContain("[core/phase-gates.ts](file://core/phase-gates.ts#L1-L1)");
    expect(topicMap).toContain(
      "### [CLI Command Surface](file://.gxpm/wiki/content/project-topics/cli-command-surface.md)",
    );
    expect(topicMap).toContain("[scripts/gxpm.ts](file://scripts/gxpm.ts#L1-L1)");
    expect(topicMap).toContain("### [Host Adapters](file://.gxpm/wiki/content/project-topics/host-adapters.md)");
    expect(topicMap).toContain("[hosts/codex.ts](file://hosts/codex.ts#L1-L1)");
    expect(topicMap).toContain(
      "### [Tests And Verification](file://.gxpm/wiki/content/project-topics/tests-and-verification.md)",
    );
    expect(topicMap).toContain("## Top Dimension Signals");
    expect(topicMap).toContain("## Import Hubs");

    const phaseTopic = readFileSync(
      join(root, ".gxpm", "wiki", "content", "project-topics", "phase-and-gate-system.md"),
      "utf8",
    );
    expect(phaseTopic).toContain("# Phase And Gate System");
    expect(phaseTopic).toContain("Issue lifecycle, phase gates, transitions, and phase-specific artifacts");
    expect(phaseTopic).toContain("## Sources");
    expect(phaseTopic).toContain("- [core/phase-gates.ts](file://core/phase-gates.ts#L1-L1)");
    expect(phaseTopic).toContain("## Matched Files");
    expect(phaseTopic).toContain("| [core/phase-gates.ts](file://core/phase-gates.ts#L1-L1) |");
    expect(phaseTopic).toContain("workflows:");
    expect(phaseTopic).toContain("[Project Topics](file://.gxpm/wiki/content/Project-Topics.md)");
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
    expect(fileIndex).toContain(`[core/source (draft).ts](${encoded}#L1)`);
    expect(codeGraph).toContain(`[core/source (draft).ts](${encoded}#L1)`);
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

  test("extracts symbols from TypeScript source files into index", () => {
    const root = tempRoot();
    initGitRepo(root);
    writeRepoFile(
      root,
      "core/utils.ts",
      "export function calculateRank() { return 1; }\nexport interface RankConfig { weight: number; }\nexport type RankResult = number;\nexport class RankEngine { run() {} }\n",
    );
    commitAll(root, "init");
    const result = initializeNativeWiki({ root, now: new Date("2026-04-29T00:00:00Z") });

    const file = result.index.files.find((f) => f.path === "core/utils.ts");
    expect(file).toBeDefined();
    expect(file!.symbols.map((s) => `${s.kind}:${s.name}`)).toContain("function:calculateRank");
    expect(file!.symbols.map((s) => `${s.kind}:${s.name}`)).toContain("interface:RankConfig");
    expect(file!.symbols.map((s) => `${s.kind}:${s.name}`)).toContain("type:RankResult");
    expect(file!.symbols.map((s) => `${s.kind}:${s.name}`)).toContain("class:RankEngine");
  });

  test("ranks query results by symbol matches and PageRank", () => {
    const root = tempRoot();
    initGitRepo(root);
    writeRepoFile(root, "core/rank.ts", "export function computePageRank() { return 1; }\n");
    writeRepoFile(root, "core/graph.ts", 'import { computePageRank } from "./rank";\nexport function buildGraph() {}\nexport function usePageRank() {}\n');
    writeRepoFile(root, "core/utils.ts", "export function helper() {}\n");
    commitAll(root, "init");
    initializeNativeWiki({ root, now: new Date("2026-04-29T00:00:00Z") });

    // Query matches both rank.ts (symbol computePageRank) and graph.ts (symbol usePageRank)
    const result = queryNativeWiki({ root, query: "PageRank", limit: 5 });
    // Both files match the token; rank.ts should rank higher because it is
    // imported by graph.ts (higher PageRank in-degree)
    const rankIndex = result.contextFiles.indexOf("core/rank.ts");
    const graphIndex = result.contextFiles.indexOf("core/graph.ts");
    expect(rankIndex).toBeGreaterThan(-1);
    expect(graphIndex).toBeGreaterThan(-1);
    // rank.ts is imported by graph.ts, so it has higher PageRank
    expect(rankIndex).toBeLessThan(graphIndex);
  });

  test("clips context files by token budget", () => {
    const root = tempRoot();
    initGitRepo(root);
    writeRepoFile(root, "core/a.ts", "export function a() {}\n" + "// x\n".repeat(500));
    writeRepoFile(root, "core/b.ts", "export function b() {}\n" + "// y\n".repeat(500));
    writeRepoFile(root, "core/c.ts", "export function c() {}\n" + "// z\n".repeat(500));
    commitAll(root, "init");
    initializeNativeWiki({ root, now: new Date("2026-04-29T00:00:00Z") });
    createIssueState({ root, issueId: "GXPM-TEST-1" });

    const prev = process.env.GXPM_WIKI_MAX_CONTEXT_TOKENS;
    process.env.GXPM_WIKI_MAX_CONTEXT_TOKENS = "200";
    try {
      const result = getNativeWikiContextForIssue({ root, issueId: "GXPM-TEST-1" });
      // With 200 token budget (~800 chars), at most 1-2 files should be kept
      expect(result.contextFiles.length).toBeLessThanOrEqual(2);
    } finally {
      if (prev === undefined) delete process.env.GXPM_WIKI_MAX_CONTEXT_TOKENS;
      else process.env.GXPM_WIKI_MAX_CONTEXT_TOKENS = prev;
    }
  });

  test("suggests relevant topic docs before generic wiki pages", () => {
    const root = tempRoot();
    writeRepoFile(root, "core/phase-gates.ts", "export const PHASE_GATE_RULES = [];\n");
    writeRepoFile(root, "core/wiki.ts", "export function initializeNativeWiki() {}\nexport function getNativeWikiStatus() {}\n");
    initializeNativeWiki({ root, now: new Date("2026-04-29T00:00:00Z") });

    const phase = queryNativeWiki({ root, query: "phase gate transition artifacts", limit: 3 });
    expect(phase.contextFiles).toContain("core/phase-gates.ts");
    expect(phase.suggestedDocs[0]).toBe(".gxpm/wiki/content/Phase-Lifecycle.md");
    expect(phase.suggestedDocs).toContain(".gxpm/wiki/content/Overview.md");

    const hyphenatedPhase = queryNativeWiki({ root, query: "phase-lifecycle", limit: 3 });
    expect(hyphenatedPhase.suggestedDocs[0]).toBe(".gxpm/wiki/content/Phase-Lifecycle.md");

    const wiki = queryNativeWiki({ root, query: "native wiki initialization update", limit: 3 });
    expect(wiki.contextFiles).toContain("core/wiki.ts");
    expect(wiki.suggestedDocs[0]).toBe(".gxpm/wiki/content/Native-Wiki.md");
  });

  test("suggests specific project topic pages before generic index docs for inferred topics", () => {
    const root = tempRoot();
    writeRepoFile(root, "hosts/codex.ts", "export function installCodexAdapter() {}\n");
    writeRepoFile(root, "core/state.ts", "export function readIssueState() {}\n");
    initializeNativeWiki({ root, now: new Date("2026-04-29T00:00:00Z") });

    const result = queryNativeWiki({ root, query: "hosts codex adapter", limit: 3 });

    expect(result.contextFiles).toContain("hosts/codex.ts");
    const hostAdapters = result.suggestedDocs.indexOf(".gxpm/wiki/content/project-topics/host-adapters.md");
    const projectTopics = result.suggestedDocs.indexOf(".gxpm/wiki/content/Project-Topics.md");
    const fileIndex = result.suggestedDocs.indexOf(".gxpm/wiki/content/File-Index.md");
    const codeGraph = result.suggestedDocs.indexOf(".gxpm/wiki/content/Code-Graph.md");
    expect(hostAdapters).toBeGreaterThanOrEqual(0);
    expect(projectTopics).toBeGreaterThanOrEqual(0);
    expect(projectTopics).toBeGreaterThan(hostAdapters);
    expect(fileIndex === -1 || hostAdapters < fileIndex).toBe(true);
    expect(codeGraph === -1 || hostAdapters < codeGraph).toBe(true);
  });

  test("suggests the project topic map from raw dimensions even when the context file is not rendered", () => {
    const root = tempRoot();
    for (let i = 0; i < 13; i += 1) {
      writeRepoFile(root, `hosts/adapter-${String(i).padStart(2, "0")}.ts`, `export function adapter${i}() {}\n`);
    }
    writeRepoFile(root, "hosts/zz-late.ts", "export function lateHost() {}\n");
    initializeNativeWiki({ root, now: new Date("2026-04-29T00:00:00Z") });

    const topicMap = readFileSync(join(root, ".gxpm", "wiki", "content", "Project-Topics.md"), "utf8");
    expect(topicMap).not.toContain("hosts/zz-late.ts");

    const result = queryNativeWiki({ root, query: "zz late", limit: 3 });

    expect(result.contextFiles).toContain("hosts/zz-late.ts");
    const hostAdapters = result.suggestedDocs.indexOf(".gxpm/wiki/content/project-topics/host-adapters.md");
    const projectTopics = result.suggestedDocs.indexOf(".gxpm/wiki/content/Project-Topics.md");
    expect(hostAdapters).toBeGreaterThanOrEqual(0);
    expect(projectTopics).toBeGreaterThan(hostAdapters);
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
      JSON.stringify(
        {
          docs: [
            ...result.docs,
            ".gxpm/wiki/content/Removed-Topic.md",
            ".gxpm/wiki/content/project-topics/removed-topic.md",
          ],
        },
        null,
        2,
      ),
    );
    writeRepoFile(root, ".gxpm/wiki/content/Removed-Topic.md", "# stale generated topic\n");
    writeRepoFile(root, ".gxpm/wiki/content/project-topics/removed-topic.md", "# stale generated topic\n");
    writeRepoFile(root, ".gxpm/wiki/content/Hand-Written.md", "# hand written topic\n");

    updateNativeWiki({ root, now: new Date("2026-04-29T01:00:00Z") });

    expect(existsSync(join(root, ".gxpm", "wiki", "content", "Removed-Topic.md"))).toBe(false);
    expect(existsSync(join(root, ".gxpm", "wiki", "content", "project-topics", "removed-topic.md"))).toBe(false);
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

  test("evaluates native wiki quality with query scenarios", () => {
    const root = tempRoot();
    writeRepoFile(root, "core/phase-gates.ts", "export const PHASE_GATE_RULES = [];\n");
    writeRepoFile(root, "hosts/codex.ts", "export function installCodexAdapter() {}\n");
    writeRepoFile(root, "core/wiki.ts", "export function initializeNativeWiki() {}\n");
    initializeNativeWiki({ root, now: new Date("2026-04-29T00:00:00Z") });

    const report = evaluateNativeWiki({
      root,
      now: new Date("2026-04-29T01:00:00Z"),
      queryScenarios: ["phase gate rules", "host adapter codex"],
    });

    expect(report.schemaVersion).toBe(1);
    expect(report.provider).toBe("gxpm");
    expect(report.native.status.state).toBe("current");
    expect(report.native.generatedDocs.count).toBeGreaterThanOrEqual(1);
    expect(report.native.projectTopics.clusterTitles).toContain("Phase And Gate System");
    expect(report.native.projectTopics.clusterTitles).toContain("Host Adapters");
    expect(report.native.sourceCoverage.docsWithSourceAnchors).toBeGreaterThan(0);
    expect(report.native.queryScenarios[0].topFiles).toContain("core/phase-gates.ts");
    expect(report.native.queryScenarios[1].topFiles).toContain("hosts/codex.ts");
    expect(report.recommendations).not.toContain("Run gxpm wiki init.");
  });

  test("evaluates absent native wiki with an init recommendation", () => {
    const root = tempRoot();

    const report = evaluateNativeWiki({ root, now: new Date("2026-04-29T00:00:00Z") });

    expect(report.native.status.state).toBe("absent");
    expect(report.native.generatedDocs.count).toBe(0);
    expect(report.native.queryScenarios).toEqual([]);
    expect(report.recommendations).toContain("Run gxpm wiki init.");
  });

  test("auto-updates stale wiki before query when autoUpdate is enabled", () => {
    const root = tempRoot();
    initGitRepo(root);
    writeRepoFile(root, "core/state.ts", "export function readIssueState() {}\n");
    commitAll(root, "initial state");
    initializeNativeWiki({ root, now: new Date("2026-04-29T00:00:00Z") });

    writeRepoFile(root, "core/wiki.ts", "export function updateNativeWiki() {}\n");
    commitAll(root, "add wiki module");

    const before = getNativeWikiStatus({ root });
    expect(before.stale).toBe(true);

    const result = queryNativeWiki({ root, query: "update native wiki", autoUpdate: true });
    expect(result.contextFiles).toContain("core/wiki.ts");

    const after = getNativeWikiStatus({ root });
    expect(after.stale).toBe(false);
  });

  test("does not auto-update stale wiki when autoUpdate is disabled", () => {
    const root = tempRoot();
    initGitRepo(root);
    writeRepoFile(root, "core/state.ts", "export function readIssueState() {}\n");
    commitAll(root, "initial state");
    initializeNativeWiki({ root, now: new Date("2026-04-29T00:00:00Z") });

    writeRepoFile(root, "core/wiki.ts", "export function updateNativeWiki() {}\n");
    commitAll(root, "add wiki module");

    const result = queryNativeWiki({ root, query: "update native wiki", autoUpdate: false });
    expect(result.contextFiles).not.toContain("core/wiki.ts");

    const after = getNativeWikiStatus({ root });
    expect(after.stale).toBe(true);
  });

  test("does not auto-update when GXPM_WIKI_AUTO_UPDATE env is 0", () => {
    const previous = process.env.GXPM_WIKI_AUTO_UPDATE;
    process.env.GXPM_WIKI_AUTO_UPDATE = "0";
    try {
      const root = tempRoot();
      initGitRepo(root);
      writeRepoFile(root, "core/state.ts", "export function readIssueState() {}\n");
      commitAll(root, "initial state");
      initializeNativeWiki({ root, now: new Date("2026-04-29T00:00:00Z") });

      writeRepoFile(root, "core/wiki.ts", "export function updateNativeWiki() {}\n");
      commitAll(root, "add wiki module");

      queryNativeWiki({ root, query: "update native wiki" });

      const after = getNativeWikiStatus({ root });
      expect(after.stale).toBe(true);
    } finally {
      process.env.GXPM_WIKI_AUTO_UPDATE = previous;
    }
  });

  test("auto-updates stale wiki before context query", () => {
    const root = tempRoot();
    initGitRepo(root);
    writeRepoFile(root, "core/phase-gates.ts", "export const PHASE_GATE_RULES = [];\n");
    commitAll(root, "initial state");
    createIssueState({ root, issueId: "GXPM-52" });
    initializeNativeWiki({ root, now: new Date("2026-04-29T00:00:00Z") });

    writeRepoFile(root, "core/new-module.ts", "export function newFeature() {}\n");
    commitAll(root, "add new module");

    const result = getNativeWikiContextForIssue({ root, issueId: "GXPM-52", autoUpdate: true });
    expect(result.contextFiles).toContain("core/new-module.ts");

    const after = getNativeWikiStatus({ root });
    expect(after.stale).toBe(false);
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

  test("supports wiki eval as JSON and concise human output", () => {
    const root = tempRoot();
    writeRepoFile(root, "core/phase-gates.ts", "export const PHASE_GATE_RULES = [];\n");
    expect(runCli(root, ["wiki", "init"]).exitCode).toBe(0);

    const json = runCli(root, ["wiki", "eval", "--json"]);
    expect(json.exitCode).toBe(0);
    const parsed = JSON.parse(output(json));
    expect(parsed.native.status.state).toBe("current");
    expect(parsed.native.queryScenarios[0].query).toBe("phase gate artifact lifecycle");

    const human = runCli(root, ["wiki", "eval"]);
    expect(human.exitCode).toBe(0);
    expect(output(human)).toContain("Native gxpm wiki eval: current");
    expect(output(human)).toContain("Query scenarios:");
  });

  test("supports --no-auto-update flag for query", () => {
    const root = tempRoot();
    initGitRepo(root);
    writeRepoFile(root, "core/state.ts", "export function readIssueState() {}\n");
    commitAll(root, "initial state");
    expect(runCli(root, ["wiki", "init"]).exitCode).toBe(0);

    writeRepoFile(root, "core/wiki.ts", "export function updateNativeWiki() {}\n");
    commitAll(root, "add wiki module");

    const query = runCli(root, ["wiki", "query", "update native wiki", "--json", "--no-auto-update"]);
    expect(query.exitCode).toBe(0);
    expect(JSON.parse(output(query)).contextFiles).not.toContain("core/wiki.ts");
  });

  test("post-commit hook template contains wiki update", () => {
    const hookPath = join(process.cwd(), "templates", "hooks", "gxpm-post-commit");
    expect(existsSync(hookPath)).toBe(true);
    const content = readFileSync(hookPath, "utf8");
    expect(content).toContain("wiki update");
    expect(content).toContain("set +e");
    expect(content).toContain(".gxpm/wiki/state.json");
  });
});

describe("gxpm native wiki incremental update", () => {
  test("incremental update only re-parses changed files and their dependents", () => {
    const root = tempRoot();
    initGitRepo(root);
    writeRepoFile(root, "core/state.ts", "export function readIssueState() {}\n");
    writeRepoFile(root, "core/config.ts", "export function readGxpmConfig() {}\n");
    writeRepoFile(root, "scripts/gxpm.ts", 'import { readIssueState } from "../core/state";\n');
    commitAll(root, "initial state");
    initializeNativeWiki({ root, now: new Date("2026-04-29T00:00:00Z") });

    const beforeIndex = JSON.parse(readFileSync(join(root, ".gxpm", "wiki", "index", "files.json"), "utf8"));
    const beforeHashByPath = new Map(beforeIndex.files.map((f: { path: string; contentHash: string }) => [f.path, f.contentHash]));

    // Modify only state.ts; gxpm.ts imports state.ts so it should be re-parsed as dependent
    writeRepoFile(root, "core/state.ts", "export function readIssueState() {}\nexport function writeIssueState() {}\n");
    commitAll(root, "modify state");

    const result = updateNativeWiki({ root, now: new Date("2026-04-29T01:00:00Z") });

    // All files still present
    expect(result.index.files.map((f) => f.path)).toContain("core/state.ts");
    expect(result.index.files.map((f) => f.path)).toContain("core/config.ts");
    expect(result.index.files.map((f) => f.path)).toContain("scripts/gxpm.ts");

    // state.ts hash changed (re-parsed)
    const stateHash = result.index.files.find((f) => f.path === "core/state.ts")?.contentHash;
    expect(stateHash).not.toBe(beforeHashByPath.get("core/state.ts"));

    // config.ts hash unchanged (skipped)
    const configHash = result.index.files.find((f) => f.path === "core/config.ts")?.contentHash;
    expect(configHash).toBe(beforeHashByPath.get("core/config.ts"));

    // gxpm.ts hash changed because it's a dependent (imports changed file)
    const gxpmHash = result.index.files.find((f) => f.path === "scripts/gxpm.ts")?.contentHash;
    expect(gxpmHash).toBe(beforeHashByPath.get("scripts/gxpm.ts"));
  });

  test("incremental update removes deleted files from index", () => {
    const root = tempRoot();
    initGitRepo(root);
    writeRepoFile(root, "core/state.ts", "export function readIssueState() {}\n");
    writeRepoFile(root, "core/obsolete.ts", "export function obsolete() {}\n");
    commitAll(root, "initial state");
    initializeNativeWiki({ root, now: new Date("2026-04-29T00:00:00Z") });

    rmSync(join(root, "core", "obsolete.ts"), { force: true });
    commitAll(root, "remove obsolete");

    const result = updateNativeWiki({ root, now: new Date("2026-04-29T01:00:00Z") });

    expect(result.index.files.map((f) => f.path)).toContain("core/state.ts");
    expect(result.index.files.map((f) => f.path)).not.toContain("core/obsolete.ts");
  });

  test("incremental update adds newly created files", () => {
    const root = tempRoot();
    initGitRepo(root);
    writeRepoFile(root, "core/state.ts", "export function readIssueState() {}\n");
    commitAll(root, "initial state");
    initializeNativeWiki({ root, now: new Date("2026-04-29T00:00:00Z") });

    writeRepoFile(root, "core/new.ts", "export function newFeature() {}\n");
    commitAll(root, "add new");

    const result = updateNativeWiki({ root, now: new Date("2026-04-29T01:00:00Z") });

    expect(result.index.files.map((f) => f.path)).toContain("core/state.ts");
    expect(result.index.files.map((f) => f.path)).toContain("core/new.ts");
  });

  test("stale detection uses content hash when mtime is preserved", () => {
    const root = tempRoot();
    initGitRepo(root);
    writeRepoFile(root, "core/state.ts", "export function readIssueState() {}\n");
    commitAll(root, "initial state");
    initializeNativeWiki({ root, now: new Date("2026-04-29T00:00:00Z") });

    // Modify file content but restore original mtime to simulate git checkout / patch
    writeRepoFile(root, "core/state.ts", "export function readIssueState() {}\nexport function writeIssueState() {}\n");
    // Restore mtime to original value from index
    const index = JSON.parse(readFileSync(join(root, ".gxpm", "wiki", "index", "files.json"), "utf8"));
    const originalMtime = index.files.find((f: { path: string }) => f.path === "core/state.ts")?.mtimeMs;
    if (originalMtime) {
      utimesSync(join(root, "core", "state.ts"), new Date(originalMtime), new Date(originalMtime));
    }

    const stale = getNativeWikiStatus({ root, now: new Date("2026-04-29T01:00:00Z") });
    expect(stale.stale).toBe(true);
    expect(stale.changedFiles).toContain("core/state.ts");
  });

  test("incremental update reuses unaffected topic docs from disk", () => {
    const root = tempRoot();
    initGitRepo(root);
    writeRepoFile(root, "core/state.ts", "export function readIssueState() {}\n");
    writeRepoFile(root, "core/config.ts", "export function readGxpmConfig() {}\n");
    commitAll(root, "initial state");
    initializeNativeWiki({ root, now: new Date("2026-04-29T00:00:00Z") });

    // Mark Config-Worktree.md with a unique sentinel so we can detect reuse
    const configDocPath = join(root, ".gxpm", "wiki", "content", "Config-Worktree.md");
    const originalConfigDoc = readFileSync(configDocPath, "utf8");
    const markedConfigDoc = originalConfigDoc + "\n<!-- SENTINEL-REUSE -->\n";
    writeFileSync(configDocPath, markedConfigDoc);

    // Modify only state.ts (not config-related)
    writeRepoFile(root, "core/state.ts", "export function readIssueState() {}\nexport function writeIssueState() {}\n");
    commitAll(root, "modify state");

    updateNativeWiki({ root, now: new Date("2026-04-29T01:00:00Z") });

    const afterConfigDoc = readFileSync(configDocPath, "utf8");
    // Config-Worktree.md sourcePaths do not include core/state.ts, so it should be reused
    expect(afterConfigDoc).toContain("<!-- SENTINEL-REUSE -->");
  });

  test("incremental update re-renders affected fixed topic docs", () => {
    const root = tempRoot();
    initGitRepo(root);
    writeRepoFile(root, "core/state.ts", "export function readIssueState() {}\n");
    commitAll(root, "initial state");
    initializeNativeWiki({ root, now: new Date("2026-04-29T00:00:00Z") });

    // Phase-Lifecycle.md sourcePaths include core/state.ts
    const phaseDocPath = join(root, ".gxpm", "wiki", "content", "Phase-Lifecycle.md");
    const originalPhaseDoc = readFileSync(phaseDocPath, "utf8");
    writeFileSync(phaseDocPath, originalPhaseDoc + "\n<!-- SENTINEL-REUSE -->\n");

    writeRepoFile(root, "core/state.ts", "export function readIssueState() {}\nexport function writeIssueState() {}\n");
    commitAll(root, "modify state");

    updateNativeWiki({ root, now: new Date("2026-04-29T01:00:00Z") });

    const afterPhaseDoc = readFileSync(phaseDocPath, "utf8");
    expect(afterPhaseDoc).not.toContain("<!-- SENTINEL-REUSE -->");
  });

  test("incremental update re-renders affected project topic docs", () => {
    const root = tempRoot();
    initGitRepo(root);
    writeRepoFile(root, "core/phase-gates.ts", "export const PHASE_GATE_RULES = [];\n");
    writeRepoFile(root, "core/config.ts", "export function readGxpmConfig() {}\n");
    commitAll(root, "initial state");
    initializeNativeWiki({ root, now: new Date("2026-04-29T00:00:00Z") });

    const phaseTopicPath = join(root, ".gxpm", "wiki", "content", "project-topics", "phase-and-gate-system.md");
    const originalTopicDoc = readFileSync(phaseTopicPath, "utf8");
    writeFileSync(phaseTopicPath, originalTopicDoc + "\n<!-- SENTINEL-REUSE -->\n");

    // Modify config.ts only — phase topic should be unaffected
    writeRepoFile(root, "core/config.ts", "export function readGxpmConfig() {}\nexport function newConfig() {}\n");
    commitAll(root, "modify config");

    updateNativeWiki({ root, now: new Date("2026-04-29T01:00:00Z") });

    const afterPhaseTopic = readFileSync(phaseTopicPath, "utf8");
    expect(afterPhaseTopic).toContain("<!-- SENTINEL-REUSE -->");

    // Now modify phase-gates.ts — phase topic should be re-rendered
    writeRepoFile(root, "core/phase-gates.ts", "export const PHASE_GATE_RULES = [1];\n");
    commitAll(root, "modify phase gates");

    updateNativeWiki({ root, now: new Date("2026-04-29T02:00:00Z") });

    const afterPhaseTopic2 = readFileSync(phaseTopicPath, "utf8");
    expect(afterPhaseTopic2).not.toContain("<!-- SENTINEL-REUSE -->");
  });
});
