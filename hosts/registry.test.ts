import { describe, it, expect } from "bun:test";
import { HostRegistry, registerHost, HOST_REGISTRY } from "./registry";
import { claudeAdapter } from "./adapters/claude";
import { codexAdapter } from "./adapters/codex";

describe("HostRegistry", () => {
  it("registers and retrieves adapters", () => {
    const registry = new HostRegistry();
    registry.register(claudeAdapter);
    expect(registry.get("claude")).toBe(claudeAdapter);
  });

  it("throws on duplicate registration", () => {
    const registry = new HostRegistry();
    registry.register(claudeAdapter);
    expect(() => registry.register(claudeAdapter)).toThrow("already registered");
  });

  it("unregisters adapters", () => {
    const registry = new HostRegistry();
    registry.register(claudeAdapter);
    expect(registry.unregister("claude")).toBe(true);
    expect(registry.has("claude")).toBe(false);
  });

  it("lists registered keys", () => {
    const registry = new HostRegistry();
    registry.register(claudeAdapter);
    registry.register(codexAdapter);
    expect(registry.list()).toEqual(["claude", "codex"]);
  });

  it("detects active hosts", () => {
    const registry = new HostRegistry();
    registry.register(claudeAdapter);
    // Detection depends on whether 'claude' is in PATH; test shape only
    const active = registry.detectAll();
    expect(Array.isArray(active)).toBe(true);
  });
});

describe("registerHost", () => {
  it("adds to global registry", () => {
    // If index.ts side-effect already ran, codex is present; test idempotent path
    if (HOST_REGISTRY.has("codex")) {
      expect(HOST_REGISTRY.get("codex")).toBe(codexAdapter);
    } else {
      registerHost(codexAdapter);
      expect(HOST_REGISTRY.has("codex")).toBe(true);
    }
  });
});
