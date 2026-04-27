import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("session resolver", () => {
  test("prefers CODEX_COMPANION_SESSION_ID over CMUX_SURFACE_ID", async () => {
    const mod = await import("../core/session").catch(() => ({} as Record<string, unknown>));
    expect(typeof mod.resolveSessionId).toBe("function");
    if (typeof mod.resolveSessionId !== "function") return;

    const id = mod.resolveSessionId({
      CODEX_COMPANION_SESSION_ID: "codex-123",
      CMUX_SURFACE_ID: "cmux-456",
      HOME: mkdtempSync(join(tmpdir(), "gxpm-session-home-")),
    });

    expect(id).toBe("codex:codex-123");
  });

  test("uses CMUX_SURFACE_ID when codex companion id is absent", async () => {
    const mod = await import("../core/session").catch(() => ({} as Record<string, unknown>));
    expect(typeof mod.resolveSessionId).toBe("function");
    if (typeof mod.resolveSessionId !== "function") return;

    const id = mod.resolveSessionId({
      CMUX_SURFACE_ID: "SURFACE-123",
      HOME: mkdtempSync(join(tmpdir(), "gxpm-session-home-")),
    });

    expect(id).toBe("cmux:SURFACE-123");
  });

  test("generates and caches a fallback id when no host session env exists", async () => {
    const mod = await import("../core/session").catch(() => ({} as Record<string, unknown>));
    expect(typeof mod.resolveSessionId).toBe("function");
    if (typeof mod.resolveSessionId !== "function") return;

    const home = mkdtempSync(join(tmpdir(), "gxpm-session-home-"));
    const first = mod.resolveSessionId({ HOME: home });
    const second = mod.resolveSessionId({ HOME: home });
    const cachePath = join(home, ".gxpm", "session-id");

    expect(first).toMatch(/^gen:[0-9a-f-]{36}$/i);
    expect(second).toBe(first);
    expect(existsSync(cachePath)).toBe(true);
    expect(readFileSync(cachePath, "utf8").trim()).toBe(first.replace(/^gen:/, ""));
  });
});
