import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  formatAutopilotGrantContext,
  listActiveAutopilotGrants,
  readAutopilotGrant,
  startAutopilotGrant,
  stopAutopilotGrant,
} from "../core/autopilot";
import { createIssueState } from "../core/state";

function tempRoot() {
  return mkdtempSync(join(tmpdir(), "gxpm-autopilot-"));
}

describe("autopilot grant", () => {
  test("starts and persists a full-delivery grant", () => {
    const root = tempRoot();
    createIssueState({ root, issueId: "GXPM-1" });

    const grant = startAutopilotGrant({
      root,
      issueId: "GXPM-1",
      prompt: "自动驾驶完成这个任务",
      now: new Date("2026-05-10T00:00:00.000Z"),
    });

    expect(grant.status).toBe("active");
    expect(grant.profile).toBe("full-delivery");
    expect(grant.allowedActions).toContain("pull-request.merge");
    expect(grant.hardStops).toContain("user.explicit_stop");
    expect(readAutopilotGrant({ root, issueId: "GXPM-1" })?.runId).toBe(grant.runId);
  });

  test("lists only active non-terminal grants", () => {
    const root = tempRoot();
    createIssueState({ root, issueId: "GXPM-1" });
    createIssueState({ root, issueId: "GXPM-2" });
    startAutopilotGrant({ root, issueId: "GXPM-1" });
    startAutopilotGrant({ root, issueId: "GXPM-2" });

    const active = listActiveAutopilotGrants({ root });

    expect(active.map((item) => item.issueId).sort()).toEqual(["GXPM-1", "GXPM-2"]);
    expect(formatAutopilotGrantContext(active)).toContain("Do not ask for confirmation");
  });

  test("stop marks grant inactive", () => {
    const root = tempRoot();
    createIssueState({ root, issueId: "GXPM-1" });
    startAutopilotGrant({ root, issueId: "GXPM-1" });

    const stopped = stopAutopilotGrant({ root, issueId: "GXPM-1", reason: "user_stop" });

    expect(stopped.status).toBe("stopped");
    expect(stopped.stopReason).toBe("user_stop");
    expect(listActiveAutopilotGrants({ root })).toHaveLength(0);
  });
});
