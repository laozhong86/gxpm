import { describe, it, expect } from "bun:test";
import { formatHookOutput } from "./hook-engine";

describe("formatHookOutput / host=claude", () => {
  it("Stop + block emits top-level {decision, reason} (Claude CLI Stop schema)", () => {
    const out = formatHookOutput("claude", "Stop", {
      action: "block",
      reason: "autopilot grant active",
      exitCode: 2,
    });
    const parsed = JSON.parse(out);
    expect(parsed).toEqual({ decision: "block", reason: "autopilot grant active" });
    expect(out).not.toContain("hookSpecificOutput");
    expect(out).not.toContain("permissionDecision");
  });

  it("PreToolUse + block still emits hookSpecificOutput.permissionDecision (no regression)", () => {
    const out = formatHookOutput("claude", "PreToolUse", {
      action: "block",
      reason: "denied by policy",
      exitCode: 2,
    });
    const parsed = JSON.parse(out);
    expect(parsed.hookSpecificOutput).toEqual({
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: "denied by policy",
    });
  });

  it("SessionStart + allow + additionalContext returns raw text (no JSON wrap)", () => {
    const ctx = "gxpm: schema v1\nactive issue: GXG-2172";
    const out = formatHookOutput("claude", "SessionStart", {
      action: "allow",
      additionalContext: ctx,
      exitCode: 0,
    });
    expect(out).toBe(ctx);
  });
});

describe("formatHookOutput / host=codex Stop (regression guard)", () => {
  it("emits top-level {decision, reason} — unchanged behaviour", () => {
    const out = formatHookOutput("codex", "Stop", {
      action: "block",
      reason: "autopilot grant active",
      exitCode: 2,
    });
    expect(JSON.parse(out)).toEqual({ decision: "block", reason: "autopilot grant active" });
  });
});
