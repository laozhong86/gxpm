import { describe, expect, test } from "bun:test";
import { join } from "node:path";

describe("gxpm-eval CLI", () => {
  test("list prints all discoverable skills", () => {
    const result = Bun.spawnSync({
      cmd: ["bun", "run", join(import.meta.dir, "..", "scripts", "eval.ts"), "list"],
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).toBe(0);
    const out = result.stdout.toString();
    expect(out).toContain("gxpm");
    expect(out).toContain("gxpm-diagnose");
    expect(out).toContain("gxpm-browser");
  });

  test("run evaluates all skills with JSON output", () => {
    const result = Bun.spawnSync({
      cmd: ["bun", "run", join(import.meta.dir, "..", "scripts", "eval.ts"), "run", "--json"],
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).toBe(0);
    const out = JSON.parse(result.stdout.toString());
    expect(out.evaluated).toBeGreaterThanOrEqual(1);
    expect(out.results.length).toBeGreaterThanOrEqual(1);

    const gxpm = out.results.find((r: { skill: string }) => r.skill === "gxpm");
    expect(gxpm).toBeDefined();
    expect(gxpm.score).toBeGreaterThanOrEqual(0);
    expect(gxpm.maxScore).toBe(60);
    expect(gxpm.checks.length).toBe(6);
  });

  test("run gxpm-diagnose evaluates one skill", () => {
    const result = Bun.spawnSync({
      cmd: ["bun", "run", join(import.meta.dir, "..", "scripts", "eval.ts"), "run", "gxpm-diagnose", "--json"],
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).toBe(0);
    const out = JSON.parse(result.stdout.toString());
    expect(out.results.length).toBe(1);
    expect(out.results[0].skill).toBe("gxpm-diagnose");
  });
});
