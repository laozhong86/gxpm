import { describe, expect, test } from "bun:test";
import { ALL_HOST_CONFIGS, ALL_HOST_NAMES, getHostConfig } from "../hosts";
import { validateAllConfigs } from "../scripts/host-config";

describe("host configs", () => {
  test("registers claude and codex hosts", () => {
    expect(ALL_HOST_NAMES).toEqual(["claude", "codex"]);
    expect(getHostConfig("claude").displayName).toBe("Claude Code");
    expect(getHostConfig("codex").displayName).toBe("OpenAI Codex CLI");
  });

  test("all host configs validate", () => {
    expect(validateAllConfigs(ALL_HOST_CONFIGS)).toEqual([]);
  });
});
