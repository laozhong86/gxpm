import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  IsolationResolver,
  createFileSystemStore,
  createGitProvider,
  type IIsolationStore,
  type IIsolationProvider,
  type IsolationEnvironment,
  type IsolationRequest,
  type IsolationCreateResult,
} from "../core/isolation-resolver";
import { createIssueState } from "../core/state";
import { writeArtifact } from "../core/artifacts";

function makeMockStore(overrides: Partial<IIsolationStore> = {}): IIsolationStore {
  return {
    getById: overrides.getById ?? (async () => undefined),
    findActiveByWorkflow: overrides.findActiveByWorkflow ?? (async () => undefined),
    findActiveByIssueId: overrides.findActiveByIssueId ?? (async () => undefined),
    create: overrides.create ?? (async (data) => ({ ...data, createdAt: new Date().toISOString() })),
    updateStatus: overrides.updateStatus ?? (async () => {}),
  };
}

function makeMockProvider(overrides: Partial<IIsolationProvider> = {}): IIsolationProvider {
  return {
    create:
      overrides.create ??
      (async (req: IsolationRequest): Promise<IsolationCreateResult> => ({
        workingPath: `/mock/${req.identifier}`,
        branchName: `gxpm-${req.identifier}`,
      })),
    destroy: overrides.destroy ?? (async () => {}),
  };
}

describe("IsolationResolver six-layer strategy", () => {
  test("Layer 1: returns existing env when valid", async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), "gxpm-iso-existing-"));
    const env: IsolationEnvironment = {
      issueId: "GXPM-10",
      workspacePath,
      branchName: "gxpm-10-feature",
      createdAt: new Date().toISOString(),
      status: "active",
    };
    const store = makeMockStore({
      getById: async (id) => (id === "GXPM-10" ? env : undefined),
    });
    const resolver = new IsolationResolver({ store, provider: makeMockProvider() });

    const result = await resolver.resolve({ issueId: "GXPM-10", existingEnvId: "GXPM-10" });
    expect(result.status).toBe("resolved");
    expect(result.method).toEqual({ type: "existing" });
    expect(result.cwd).toBe(workspacePath);
  });

  test("Layer 1: returns stale_cleaned when existing env path missing", async () => {
    const store = makeMockStore({
      getById: async (id) =>
        id === "GXPM-10"
          ? {
              issueId: "GXPM-10",
              workspacePath: "/nonexistent/GXPM-10",
              createdAt: new Date().toISOString(),
              status: "active",
            }
          : undefined,
    });
    const resolver = new IsolationResolver({ store, provider: makeMockProvider() });

    const result = await resolver.resolve({ issueId: "GXPM-10", existingEnvId: "GXPM-10" });
    expect(result.status).toBe("stale_cleaned");
    expect(result.previousEnvId).toBe("GXPM-10");
  });

  test("Layer 2: returns none when not a git repo", async () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-iso-none-"));
    const store = makeMockStore();
    const resolver = new IsolationResolver({ store, provider: makeMockProvider() });

    const result = await resolver.resolve({ issueId: "GXPM-11", root });
    expect(result.status).toBe("none");
    expect(result.cwd).toContain("GXPM-11");
  });

  test("Layer 3: returns workflow reuse when reusable env found", async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), "gxpm-iso-reuse-"));
    // Need a git repo as root
    const root = mkdtempSync(join(tmpdir(), "gxpm-iso-reuse-root-"));
    Bun.spawnSync({ cmd: ["git", "init"], cwd: root });
    Bun.spawnSync({ cmd: ["git", "config", "user.email", "test@test.com"], cwd: root });
    Bun.spawnSync({ cmd: ["git", "config", "user.name", "Test"], cwd: root });
    writeFileSync(join(root, "file.txt"), "hello");
    Bun.spawnSync({ cmd: ["git", "add", "."], cwd: root });
    Bun.spawnSync({ cmd: ["git", "commit", "-m", "init"], cwd: root });

    const env: IsolationEnvironment = {
      issueId: "GXPM-12",
      workspacePath,
      branchName: "gxpm-12-feature",
      createdAt: new Date().toISOString(),
      status: "active",
    };
    const store = makeMockStore({
      findActiveByWorkflow: async () => env,
    });
    const resolver = new IsolationResolver({ store, provider: makeMockProvider() });

    const result = await resolver.resolve({
      issueId: "GXPM-12",
      root,
      hints: { workflowType: "feature", workflowId: "feat-1" },
    });
    expect(result.status).toBe("resolved");
    expect(result.method).toEqual({ type: "workflow_reuse" });
  });

  test("Layer 4: returns linked issue reuse when linked env found", async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), "gxpm-iso-linked-"));
    const root = mkdtempSync(join(tmpdir(), "gxpm-iso-linked-root-"));
    Bun.spawnSync({ cmd: ["git", "init"], cwd: root });
    Bun.spawnSync({ cmd: ["git", "config", "user.email", "test@test.com"], cwd: root });
    Bun.spawnSync({ cmd: ["git", "config", "user.name", "Test"], cwd: root });
    writeFileSync(join(root, "file.txt"), "hello");
    Bun.spawnSync({ cmd: ["git", "add", "."], cwd: root });
    Bun.spawnSync({ cmd: ["git", "commit", "-m", "init"], cwd: root });

    const env: IsolationEnvironment = {
      issueId: "GXPM-13",
      workspacePath,
      branchName: "gxpm-13-feature",
      createdAt: new Date().toISOString(),
      status: "active",
    };
    const store = makeMockStore({
      findActiveByIssueId: async (id) => (id === "GXPM-13" ? env : undefined),
    });
    const resolver = new IsolationResolver({ store, provider: makeMockProvider() });

    const result = await resolver.resolve({
      issueId: "GXPM-14",
      root,
      hints: { linkedIssues: ["GXPM-13"] },
    });
    expect(result.status).toBe("resolved");
    expect(result.method).toEqual({ type: "linked_issue_reuse", linkedIssueId: "GXPM-13" });
  });

  test("Layer 5: returns branch adoption when worktree exists for prBranch", async () => {
    // This test requires a real git repo; we'll skip if not available
    const root = mkdtempSync(join(tmpdir(), "gxpm-iso-adopt-"));
    // Initialize a git repo
    const initResult = Bun.spawnSync({ cmd: ["git", "init"], cwd: root, stdout: "pipe", stderr: "pipe" });
    if (initResult.exitCode !== 0) {
      // Git not available
      return;
    }
    // Configure git user for commits
    Bun.spawnSync({ cmd: ["git", "config", "user.email", "test@test.com"], cwd: root });
    Bun.spawnSync({ cmd: ["git", "config", "user.name", "Test"], cwd: root });
    writeFileSync(join(root, "file.txt"), "hello");
    Bun.spawnSync({ cmd: ["git", "add", "."], cwd: root });
    Bun.spawnSync({ cmd: ["git", "commit", "-m", "init"], cwd: root });

    // Create a branch and worktree
    const branchName = "gxpm-15-adopt";
    const worktreePath = mkdtempSync(join(tmpdir(), "gxpm-worktree-"));
    const addResult = Bun.spawnSync({
      cmd: ["git", "worktree", "add", "-b", branchName, worktreePath],
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (addResult.exitCode !== 0) {
      throw new Error(`git worktree add failed: ${addResult.stderr.toString()}`);
    }

    const store = makeMockStore();
    const resolver = new IsolationResolver({ store, provider: makeMockProvider() });

    const result = await resolver.resolve({
      issueId: "GXPM-15",
      root,
      hints: { prBranch: branchName },
    });
    expect(result.status).toBe("resolved");
    expect(result.method).toEqual({ type: "branch_adoption", branch: branchName });
  });

  test("Layer 6: creates new environment when nothing matches", async () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-iso-create-"));
    // Initialize a git repo
    const initResult = Bun.spawnSync({ cmd: ["git", "init"], cwd: root, stdout: "pipe", stderr: "pipe" });
    if (initResult.exitCode !== 0) return;

    Bun.spawnSync({ cmd: ["git", "config", "user.email", "test@test.com"], cwd: root });
    Bun.spawnSync({ cmd: ["git", "config", "user.name", "Test"], cwd: root });
    writeFileSync(join(root, "file.txt"), "hello");
    Bun.spawnSync({ cmd: ["git", "add", "."], cwd: root });
    Bun.spawnSync({ cmd: ["git", "commit", "-m", "init"], cwd: root });

    const created = { workingPath: "/mock/GXPM-16", branchName: "gxpm-16-feature", warnings: ["warn"] };
    const store = makeMockStore();
    const provider = makeMockProvider({
      create: async () => created,
    });
    const resolver = new IsolationResolver({ store, provider });

    const result = await resolver.resolve({ issueId: "GXPM-16", root });
    expect(result.status).toBe("resolved");
    expect(result.method).toEqual({ type: "created" });
    expect(result.warnings).toEqual(["warn"]);
  });

  test("Layer 6: returns blocked on known creation error", async () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-iso-blocked-"));
    Bun.spawnSync({ cmd: ["git", "init"], cwd: root });
    Bun.spawnSync({ cmd: ["git", "config", "user.email", "test@test.com"], cwd: root });
    Bun.spawnSync({ cmd: ["git", "config", "user.name", "Test"], cwd: root });
    writeFileSync(join(root, "file.txt"), "hello");
    Bun.spawnSync({ cmd: ["git", "add", "."], cwd: root });
    Bun.spawnSync({ cmd: ["git", "commit", "-m", "init"], cwd: root });

    const store = makeMockStore();
    const provider = makeMockProvider({
      create: async () => {
        const err = new Error("permission denied");
        (err as Error & { stderr?: string }).stderr = "";
        throw err;
      },
    });
    const resolver = new IsolationResolver({ store, provider });

    const result = await resolver.resolve({ issueId: "GXPM-17", root });
    expect(result.status).toBe("blocked");
    expect(result.userMessage).toContain("Permission denied");
  });

  test("Layer 6: re-throws unknown creation errors", async () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-iso-throw-"));
    Bun.spawnSync({ cmd: ["git", "init"], cwd: root });
    Bun.spawnSync({ cmd: ["git", "config", "user.email", "test@test.com"], cwd: root });
    Bun.spawnSync({ cmd: ["git", "config", "user.name", "Test"], cwd: root });
    writeFileSync(join(root, "file.txt"), "hello");
    Bun.spawnSync({ cmd: ["git", "add", "."], cwd: root });
    Bun.spawnSync({ cmd: ["git", "commit", "-m", "init"], cwd: root });

    const store = makeMockStore();
    const provider = makeMockProvider({
      create: async () => {
        throw new Error("unexpected bug");
      },
    });
    const resolver = new IsolationResolver({ store, provider });

    await expect(resolver.resolve({ issueId: "GXPM-18", root })).rejects.toThrow("unexpected bug");
  });

  test("orphan cleanup when store.create fails after provider.create succeeds", async () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-iso-orphan-"));
    Bun.spawnSync({ cmd: ["git", "init"], cwd: root });
    Bun.spawnSync({ cmd: ["git", "config", "user.email", "test@test.com"], cwd: root });
    Bun.spawnSync({ cmd: ["git", "config", "user.name", "Test"], cwd: root });
    writeFileSync(join(root, "file.txt"), "hello");
    Bun.spawnSync({ cmd: ["git", "add", "."], cwd: root });
    Bun.spawnSync({ cmd: ["git", "commit", "-m", "init"], cwd: root });

    let destroyed = false;
    const store = makeMockStore({
      create: async () => {
        throw new Error("store failure");
      },
    });
    const provider = makeMockProvider({
      create: async () => ({ workingPath: "/mock/orphan", branchName: "gxpm-orphan" }),
      destroy: async () => {
        destroyed = true;
      },
    });
    const resolver = new IsolationResolver({ store, provider });

    await expect(resolver.resolve({ issueId: "GXPM-19", root })).rejects.toThrow("store failure");
    expect(destroyed).toBe(true);
  });

  test("rejects invalid staleThresholdDays", () => {
    expect(() => new IsolationResolver({ store: makeMockStore(), provider: makeMockProvider(), staleThresholdDays: 0 })).toThrow(
      "staleThresholdDays must be positive",
    );
    expect(() => new IsolationResolver({ store: makeMockStore(), provider: makeMockProvider(), staleThresholdDays: -1 })).toThrow(
      "staleThresholdDays must be positive",
    );
  });
});

describe("createFileSystemStore", () => {
  test("getById returns env from dispatch-handoff artifact", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-iso-store-"));
    createIssueState({ root, issueId: "GXPM-20" });
    writeArtifact({
      root,
      issueId: "GXPM-20",
      type: "dispatch-handoff",
      payload: { worktree: "/ws/GXPM-20", branch: "gxpm-20-feat" },
    });

    const store = createFileSystemStore(root);
    const env = store.getById("GXPM-20");
    expect(env).resolves.toMatchObject({
      issueId: "GXPM-20",
      workspacePath: "/ws/GXPM-20",
      branchName: "gxpm-20-feat",
      status: "active",
    });
  });

  test("getById returns undefined when no dispatch-handoff", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-iso-store-miss-"));
    createIssueState({ root, issueId: "GXPM-21" });

    const store = createFileSystemStore(root);
    expect(store.getById("GXPM-21")).resolves.toBeUndefined();
  });

  test("create returns env with createdAt", async () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-iso-store-create-"));
    const store = createFileSystemStore(root);
    const env = await store.create({
      issueId: "GXPM-22",
      workspacePath: "/ws/GXPM-22",
      status: "active",
    });
    expect(env.createdAt).toBeTruthy();
    expect(env.issueId).toBe("GXPM-22");
  });
});

describe("createGitProvider", () => {
  test("createGitProvider is exported", () => {
    expect(typeof createGitProvider).toBe("function");
  });
});
