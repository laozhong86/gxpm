import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createIssueState,
  readIssueState,
  transitionIssuePhase,
  setIssueArchived,
} from "../core/state";
import { writeArtifact } from "../core/artifacts";
import {
  readSyncState,
  writeSyncState,
  resolveSyncProvider,
  maybeSyncIssue,
} from "../core/issue-sync";

describe("issue sync", () => {
  let originalFetch: typeof fetch;
  let originalEnv: string | undefined;
  let fetchCalls: Array<{ url: string; init: RequestInit }>;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalEnv = process.env.GXPM_LINEAR_API_KEY;
    fetchCalls = [];
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalEnv !== undefined) {
      process.env.GXPM_LINEAR_API_KEY = originalEnv;
    } else {
      delete process.env.GXPM_LINEAR_API_KEY;
    }
  });

  function mockFetch(responses: Array<{ matcher: (url: string, body: string) => boolean; data: Record<string, unknown> }>) {
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = String(init?.body ?? "{}");
      fetchCalls.push({ url, init: init ?? {} });
      const match = responses.find((r) => r.matcher(url, body));
      const data = match?.data ?? {};
      return new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });
    };
  }

  test("resolveSyncProvider returns null when not configured", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-sync-none-"));
    mkdirSync(join(root, ".gxpm"), { recursive: true });
    writeFileSync(join(root, ".gxpm", "config.json"), JSON.stringify({}));
    const provider = resolveSyncProvider(root);
    expect(provider).toBeNull();
  });

  test("resolveSyncProvider returns null when autoSync is disabled", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-sync-disabled-"));
    mkdirSync(join(root, ".gxpm"), { recursive: true });
    writeFileSync(
      join(root, ".gxpm", "config.json"),
      JSON.stringify({ sync: { provider: "linear", autoSync: false } }),
    );
    process.env.GXPM_LINEAR_API_KEY = "test-key";
    const provider = resolveSyncProvider(root);
    expect(provider).toBeNull();
  });

  test("resolveSyncProvider uses sync.linearApiKey from config.json when env var is absent", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-sync-config-apikey-"));
    mkdirSync(join(root, ".gxpm"), { recursive: true });
    writeFileSync(
      join(root, ".gxpm", "config.json"),
      JSON.stringify({ sync: { provider: "linear", linearTeamId: "team-1", linearApiKey: "config-key" } }),
    );
    delete process.env.GXPM_LINEAR_API_KEY;

    mockFetch([
      {
        matcher: (_url, body) => body.includes("WorkflowStates"),
        data: { data: { team: { states: { nodes: [{ id: "st-triage", name: "Triage", type: "triage" }] } } } },
      },
    ]);

    const provider = resolveSyncProvider(root);
    expect(provider).not.toBeNull();
    expect(provider?.name).toBe("linear");
  });

  test("readSyncState returns empty state when file does not exist", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-sync-read-"));
    const state = readSyncState({ root, issueId: "GXPM-SYNC-1" });
    expect(state.schemaVersion).toBe(1);
    expect(state.targets).toHaveLength(0);
  });

  test("writeSyncState persists sync data", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-sync-write-"));
    const state = {
      schemaVersion: 1,
      issueId: "GXPM-SYNC-2",
      targets: [
        {
          provider: "linear" as const,
          externalId: "ext-123",
          displayId: "ENG-1",
          url: "https://linear.app/issue/ENG-1",
        },
      ],
    };
    writeSyncState({ root, issueId: "GXPM-SYNC-2", state });
    const read = readSyncState({ root, issueId: "GXPM-SYNC-2" });
    expect(read.targets).toHaveLength(1);
    expect(read.targets[0].displayId).toBe("ENG-1");
  });

  test("createIssueState triggers sync when Linear is configured", async () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-sync-create-"));
    mkdirSync(join(root, ".gxpm"), { recursive: true });
    writeFileSync(
      join(root, ".gxpm", "config.json"),
      JSON.stringify({ sync: { provider: "linear", linearTeamId: "team-1", linearTeamKey: "ENG" } }),
    );
    process.env.GXPM_LINEAR_API_KEY = "lin_test";

    mockFetch([
      {
        matcher: (_url, body) => body.includes("WorkflowStates"),
        data: { data: { team: { states: { nodes: [{ id: "st-triage", name: "Triage", type: "triage" }] } } } },
      },
      {
        matcher: (_url, body) => body.includes("IssueCreate"),
        data: { data: { issueCreate: { success: true, issue: { id: "lin-1", identifier: "ENG-99", url: "https://linear.app/ENG-99" } } } },
      },
    ]);

    createIssueState({ root, issueId: "GXPM-SYNC-3" });

    // Wait for dynamic import + async sync
    await new Promise((r) => setTimeout(r, 100));

    const syncState = readSyncState({ root, issueId: "GXPM-SYNC-3" });
    expect(syncState.targets).toHaveLength(1);
    expect(syncState.targets[0].provider).toBe("linear");
    expect(syncState.targets[0].displayId).toBe("ENG-99");
  });

  test("transitionIssuePhase triggers sync update", async () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-sync-transition-"));
    mkdirSync(join(root, ".gxpm"), { recursive: true });
    writeFileSync(
      join(root, ".gxpm", "config.json"),
      JSON.stringify({ sync: { provider: "linear", linearTeamId: "team-1" } }),
    );
    process.env.GXPM_LINEAR_API_KEY = "lin_test";

    mockFetch([
      {
        matcher: (_url, body) => body.includes("WorkflowStates"),
        data: { data: { team: { states: { nodes: [
          { id: "st-triage", name: "Triage", type: "triage" },
          { id: "st-backlog", name: "Backlog", type: "backlog" },
        ] } } } },
      },
      {
        matcher: (_url, body) => body.includes("IssueCreate"),
        data: { data: { issueCreate: { success: true, issue: { id: "lin-2", identifier: "ENG-2", url: "https://linear.app/ENG-2" } } } },
      },
      {
        matcher: (_url, body) => body.includes("IssueUpdate"),
        data: { data: { issueUpdate: { success: true } } },
      },
    ]);

    createIssueState({ root, issueId: "GXPM-SYNC-4" });
    await new Promise((r) => setTimeout(r, 100));

    // Pre-create the required artifact for transition
    writeArtifact({ root, issueId: "GXPM-SYNC-4", type: "acceptance-contract", payload: { criteria: [] } });

    transitionIssuePhase({ root, issueId: "GXPM-SYNC-4", nextPhase: "plan" });
    await new Promise((r) => setTimeout(r, 100));

    const updateCalls = fetchCalls.filter((c) => String(c.init.body).includes("IssueUpdate"));
    expect(updateCalls.length).toBeGreaterThanOrEqual(1);
  });

  test("setIssueArchived triggers sync archive", async () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-sync-archive-"));
    mkdirSync(join(root, ".gxpm"), { recursive: true });
    writeFileSync(
      join(root, ".gxpm", "config.json"),
      JSON.stringify({ sync: { provider: "linear", linearTeamId: "team-1" } }),
    );
    process.env.GXPM_LINEAR_API_KEY = "lin_test";

    mockFetch([
      {
        matcher: (_url, body) => body.includes("WorkflowStates"),
        data: { data: { team: { states: { nodes: [
          { id: "st-triage", name: "Triage", type: "triage" },
          { id: "st-canceled", name: "Canceled", type: "canceled" },
        ] } } } },
      },
      {
        matcher: (_url, body) => body.includes("IssueCreate"),
        data: { data: { issueCreate: { success: true, issue: { id: "lin-3", identifier: "ENG-3", url: "https://linear.app/ENG-3" } } } },
      },
      {
        matcher: (_url, body) => body.includes("IssueUpdate"),
        data: { data: { issueUpdate: { success: true } } },
      },
    ]);

    createIssueState({ root, issueId: "GXPM-SYNC-5" });
    await new Promise((r) => setTimeout(r, 100));

    setIssueArchived({ root, issueId: "GXPM-SYNC-5", archived: true });
    await new Promise((r) => setTimeout(r, 100));

    const syncState = readSyncState({ root, issueId: "GXPM-SYNC-5" });
    expect(syncState.targets[0].lastError).toBeUndefined();
  });

  test("sync failure is silently recorded without blocking local ops", async () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-sync-fail-"));
    mkdirSync(join(root, ".gxpm"), { recursive: true });
    writeFileSync(
      join(root, ".gxpm", "config.json"),
      JSON.stringify({ sync: { provider: "linear", linearTeamId: "team-1" } }),
    );
    process.env.GXPM_LINEAR_API_KEY = "lin_test";

    globalThis.fetch = async () => {
      return new Response(JSON.stringify({ errors: [{ message: "rate limited" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const state = createIssueState({ root, issueId: "GXPM-SYNC-6" });
    expect(state.issueId).toBe("GXPM-SYNC-6");

    await new Promise((r) => setTimeout(r, 100));

    const syncState = readSyncState({ root, issueId: "GXPM-SYNC-6" });
    // Since creation failed, no target should be linked yet
    expect(syncState.targets).toHaveLength(0);
  });

  test("createIssue includes repo label and description with repo info", async () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-sync-repo-"));
    mkdirSync(join(root, ".gxpm"), { recursive: true });
    writeFileSync(
      join(root, ".gxpm", "config.json"),
      JSON.stringify({ sync: { provider: "linear", linearTeamId: "team-1", linearTeamKey: "ENG" } }),
    );
    process.env.GXPM_LINEAR_API_KEY = "lin_test";

    mockFetch([
      {
        matcher: (_url, body) => body.includes("WorkflowStates"),
        data: { data: { team: { states: { nodes: [{ id: "st-triage", name: "Triage", type: "triage" }] } } } },
      },
      {
        matcher: (_url, body) => body.includes("issueLabelCreate"),
        data: { data: { issueLabelCreate: { success: true } } },
      },
      {
        matcher: (_url, body) => body.includes("issueLabels"),
        data: { data: { issueLabels: { nodes: [{ id: "lbl-repo", name: "repo:gxpm-sync-repo-" }] } } },
      },
      {
        matcher: (_url, body) => body.includes("IssueCreate"),
        data: { data: { issueCreate: { success: true, issue: { id: "lin-7", identifier: "ENG-7", url: "https://linear.app/ENG-7" } } } },
      },
    ]);

    createIssueState({ root, issueId: "GXPM-SYNC-7" });
    await new Promise((r) => setTimeout(r, 100));

    const createCall = fetchCalls.find((c) => String(c.init.body).includes("IssueCreate"));
    expect(createCall).toBeDefined();
    const createBody = JSON.parse(String(createCall!.init.body));
    const input = createBody.variables.input;

    // Repo label is attached
    expect(input.labelIds).toBeDefined();
    expect(input.labelIds).toContain("lbl-repo");

    // Description contains repo info (fallback to directory basename since no git remote)
    expect(input.description).toContain("Repository:");
    expect(input.description).toContain("Local Path:");
    expect(input.description).toContain(root);

    const syncState = readSyncState({ root, issueId: "GXPM-SYNC-7" });
    expect(syncState.targets).toHaveLength(1);
    expect(syncState.targets[0].displayId).toBe("ENG-7");
  });
});
