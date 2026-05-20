import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync, readlinkSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  WorktreeInitPipeline,
  createPipeline,
  runWorktreeInit,
  ensureSymlink,
  setEnvVar,
  readEnvFile,
  safeWorktreeSlug,
  hashSlot,
  checkPortAvailable,
  type WorktreeInitContext,
  type WorktreeInitStep,
} from "../core/worktree-init";
import "../core/worktree-init-steps"; // side-effect: registers built-in init steps

describe("WorktreeInitPipeline", () => {
  it("runs steps in order and collects warnings", async () => {
    const pipeline = new WorktreeInitPipeline();
    const order: string[] = [];

    pipeline.add({
      name: "step-a",
      run: () => {
        order.push("a");
        return { ok: true, warnings: ["a-warning"] };
      },
    });
    pipeline.add({
      name: "step-b",
      run: () => {
        order.push("b");
        return { ok: true };
      },
    });

    const result = await pipeline.run({
      canonicalRepoPath: "/tmp/main",
      worktreePath: "/tmp/wt",
      branchName: "gxpm-1",
      issueId: "GXPM-1",
    });

    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual(["a-warning"]);
    expect(order).toEqual(["a", "b"]);
  });

  it("continues after a step failure by default", async () => {
    const pipeline = new WorktreeInitPipeline();
    pipeline.add({
      name: "fail",
      run: () => ({ ok: false, error: "boom" }),
    });
    pipeline.add({
      name: "ok",
      run: () => ({ ok: true }),
    });

    const result = await pipeline.run({
      canonicalRepoPath: "/tmp/main",
      worktreePath: "/tmp/wt",
      branchName: "gxpm-1",
      issueId: "GXPM-1",
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(["[fail] boom"]);
    expect(result.stepsRun).toEqual(["fail", "ok"]);
  });

  it("catches step exceptions and reports them", async () => {
    const pipeline = new WorktreeInitPipeline();
    pipeline.add({
      name: "throw",
      run: () => {
        throw new Error("unexpected");
      },
    });

    const result = await pipeline.run({
      canonicalRepoPath: "/tmp/main",
      worktreePath: "/tmp/wt",
      branchName: "gxpm-1",
      issueId: "GXPM-1",
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(["[throw] unexpected"]);
  });
});

describe("createPipeline", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "gxpm-pipeline-"));
    mkdirSync(join(root, ".gxpm"), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("uses explicit steps when provided", () => {
    const pipeline = createPipeline({ steps: ["owner-marker"], root });
    expect(pipeline).toBeDefined();
  });

  it("warns on unknown steps", async () => {
    const pipeline = createPipeline({ steps: ["nonexistent-step"], root });
    const result = await pipeline.run({
      canonicalRepoPath: root,
      worktreePath: join(root, "wt"),
      branchName: "gxpm-1",
      issueId: "GXPM-1",
    });
    expect(result.ok).toBe(false);
    expect(result.warnings.some((w) => w.includes("Unknown worktree init step"))).toBe(true);
  });
});

describe("ensureSymlink", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "gxpm-symlink-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("creates a symlink when dst does not exist", () => {
    const src = join(tmp, "src");
    const dst = join(tmp, "dst");
    mkdirSync(src, { recursive: true });

    const result = ensureSymlink(src, dst);
    expect(result.ok).toBe(true);
    expect(existsSync(dst)).toBe(true);
  });

  it("returns ok when symlink already points to src", () => {
    const src = join(tmp, "src");
    const dst = join(tmp, "dst");
    mkdirSync(src, { recursive: true });
    symlinkSync(src, dst, "dir");

    const result = ensureSymlink(src, dst);
    expect(result.ok).toBe(true);
  });

  it("rewrites symlink when it points elsewhere", () => {
    const src = join(tmp, "src");
    const other = join(tmp, "other");
    const dst = join(tmp, "dst");
    mkdirSync(src, { recursive: true });
    mkdirSync(other, { recursive: true });
    symlinkSync(other, dst, "dir");

    const result = ensureSymlink(src, dst);
    expect(result.ok).toBe(true);
    expect(resolve(readlinkSync(dst))).toBe(resolve(src));
  });

  it("warns when dst is a real directory", () => {
    const src = join(tmp, "src");
    const dst = join(tmp, "dst");
    mkdirSync(src, { recursive: true });
    mkdirSync(dst, { recursive: true });

    const result = ensureSymlink(src, dst);
    expect(result.ok).toBe(false);
    expect(result.warning).toContain("overlay conflict");
  });
});

describe("setEnvVar / readEnvFile", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "gxpm-env-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("sets a new env var", () => {
    const path = join(tmp, ".env.local");
    setEnvVar(path, "PORT", "3001");
    expect(readFileSync(path, "utf8")).toContain("PORT=3001");
  });

  it("overwrites an existing env var", () => {
    const path = join(tmp, ".env.local");
    writeFileSync(path, "PORT=3000\n");
    setEnvVar(path, "PORT", "3001");
    const content = readFileSync(path, "utf8");
    expect(content).toContain("PORT=3001");
    expect(content).not.toContain("PORT=3000");
  });

  it("reads env file correctly", () => {
    const path = join(tmp, ".env");
    writeFileSync(path, "# comment\nFOO=bar\nBAZ=qux\n\n");
    const vars = readEnvFile(path);
    expect(vars).toEqual({ FOO: "bar", BAZ: "qux" });
  });
});

describe("safeWorktreeSlug", () => {
  it("lowercases and replaces special chars", () => {
    expect(safeWorktreeSlug("Hello World!!!")).toBe("hello_world");
  });

  it("truncates to 48 chars", () => {
    const long = "a".repeat(100);
    expect(safeWorktreeSlug(long).length).toBe(48);
  });

  it("falls back to hash for empty input", () => {
    expect(safeWorktreeSlug("")).toMatch(/^[a-f0-9]{8}$/);
  });
});

describe("hashSlot", () => {
  it("returns a deterministic 1-based slot", () => {
    const slot1 = hashSlot("foo", 10);
    const slot2 = hashSlot("foo", 10);
    expect(slot1).toBe(slot2);
    expect(slot1).toBeGreaterThanOrEqual(1);
    expect(slot1).toBeLessThanOrEqual(10);
  });

  it("returns different slots for different inputs (high probability)", () => {
    const slot1 = hashSlot("foo", 10);
    const slot2 = hashSlot("bar", 10);
    expect(slot1).not.toBe(slot2);
  });
});

describe("checkPortAvailable", () => {
  it("returns true when lsof is not available or finds nothing", () => {
    // Port 1 is highly unlikely to be listening
    expect(checkPortAvailable(1, "/tmp")).toBe(true);
  });
});

describe("runWorktreeInit integration", () => {
  let main: string;
  let wt: string;

  beforeEach(() => {
    main = mkdtempSync(join(tmpdir(), "gxpm-init-main-"));
    wt = mkdtempSync(join(tmpdir(), "gxpm-init-wt-"));
    mkdirSync(join(main, ".gxpm"), { recursive: true });
    writeFileSync(join(main, ".gxpm", "config.json"), JSON.stringify({
      worktree: {
        initSteps: ["owner-marker", "issue-context"],
      },
    }));
  });

  afterEach(() => {
    rmSync(main, { recursive: true, force: true });
    rmSync(wt, { recursive: true, force: true });
  });

  it("runs default steps and produces owner marker + issue context", async () => {
    const ctx: WorktreeInitContext = {
      canonicalRepoPath: main,
      worktreePath: wt,
      branchName: "gxpm-42",
      issueId: "GXPM-42",
    };

    const result = await runWorktreeInit(ctx, { root: main });
    if (!result.ok) {
      throw new Error(`init failed: ${JSON.stringify(result, null, 2)}`);
    }
    expect(existsSync(join(wt, ".gxpm-worktree-owner.json"))).toBe(true);
    expect(existsSync(join(wt, "ISSUE_CONTEXT.md"))).toBe(true);

    const owner = JSON.parse(readFileSync(join(wt, ".gxpm-worktree-owner.json"), "utf8"));
    expect(owner.ownerIssueId).toBe("GXPM-42");
  });

  it("port-allocation populates ctx.ports with a queuePrefix and never throws", async () => {
    // Regression: port-allocation used createHash without importing it,
    // causing a ReferenceError that left ctx.ports undefined and silently
    // failed every downstream step (generate-env-local / generate-warp-md /
    // generate-launch-json). See worktree where warp.md was missing despite
    // gxpm reporting a dev port.
    const ctx: WorktreeInitContext = {
      canonicalRepoPath: main,
      worktreePath: wt,
      branchName: "gxpm-99",
      issueId: "GXPM-99",
    };

    const result = await runWorktreeInit(ctx, {
      steps: ["port-allocation"],
      root: main,
    });

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(ctx.ports).toBeDefined();
    expect(ctx.ports?.queuePrefix).toMatch(/^gxpm_wt_/);
    expect(ctx.ports?.webPort).toBeGreaterThan(0);
    expect(ctx.ports?.serverPort).toBeGreaterThan(0);
    expect(ctx.ports?.studioPort).toBeGreaterThan(0);
  });

  it("port-allocation + generate-warp-md actually writes warp.md", async () => {
    // Regression: even when port-allocation crashed, the pipeline marched on
    // and generate-warp-md returned "port-allocation step must run before
    // generate-warp-md" — leaving the worktree without warp.md.
    const ctx: WorktreeInitContext = {
      canonicalRepoPath: main,
      worktreePath: wt,
      branchName: "gxpm-99",
      issueId: "GXPM-99",
    };

    const result = await runWorktreeInit(ctx, {
      steps: ["port-allocation", "generate-warp-md"],
      root: main,
    });

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(existsSync(join(wt, "warp.md"))).toBe(true);

    const content = readFileSync(join(wt, "warp.md"), "utf8");
    expect(content).toContain("Worktree Port Configuration");
    expect(content).toContain(String(ctx.ports?.webPort));
  });
});
