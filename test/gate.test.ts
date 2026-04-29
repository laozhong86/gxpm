import { describe, expect, test } from "bun:test";
import {
  evaluateBranchPolicy,
  evaluatePreCommit,
  evaluateCommitMsg,
  evaluatePrePush,
  evaluatePostMerge,
} from "../core/gate";
import type { GxpmPhase, IssueState } from "../core/state";

const stateAt = (phase: GxpmPhase): IssueState => ({
  schemaVersion: 1,
  issueId: "GXPM-100",
  currentPhase: phase,
  createdAt: "2026-04-26T00:00:00Z",
  updatedAt: "2026-04-26T00:00:00Z",
  stateRoot: ".gxpm/issues/GXPM-100",
  artifactRoot: ".gxpm/issues/GXPM-100/artifacts",
  phaseHistory: [{ phase, enteredAt: "2026-04-26T00:00:00Z", fromPhase: null }],
});

describe("evaluatePreCommit", () => {
  test("blocks code edits during triage", () => {
    const v = evaluatePreCommit(stateAt("triage"), ["server/src/x.ts"], {});
    expect(v.allowed).toBe(false);
    expect(v.code).toBe("wrong-phase");
  });

  test("allows code edits during implement", () => {
    const v = evaluatePreCommit(stateAt("implement"), ["server/src/x.ts"], {});
    expect(v.allowed).toBe(true);
    expect(v.code).toBe("phase-ok");
  });

  test("allows docs-only commits in any phase", () => {
    const v = evaluatePreCommit(stateAt("triage"), ["docs/foo.md", "README.md"], {});
    expect(v.allowed).toBe(true);
    expect(v.code).toBe("no-protected-paths");
  });

  test("respects GXPM_GATE_DISABLE env", () => {
    const v = evaluatePreCommit(stateAt("triage"), ["server/src/x.ts"], {
      GXPM_GATE_DISABLE: "1",
    });
    expect(v.allowed).toBe(true);
    expect(v.code).toBe("disabled");
  });

  test("allows when no protected paths staged across mixed list", () => {
    const v = evaluatePreCommit(stateAt("plan"), ["docs/foo.md", "AGENTS.md"], {});
    expect(v.allowed).toBe(true);
  });

  test("blocks when at least one protected path staged in non-impl phase", () => {
    const v = evaluatePreCommit(stateAt("plan"), ["docs/foo.md", "server/y.ts"], {});
    expect(v.allowed).toBe(false);
    expect(v.code).toBe("wrong-phase");
  });
});

describe("evaluateBranchPolicy", () => {
  test("allows the canonical main checkout on main", () => {
    const v = evaluateBranchPolicy({
      currentRoot: "/repo/gxpm",
      currentBranch: "main",
      canonicalMainRoot: "/repo/gxpm",
      env: {},
    });

    expect(v.allowed).toBe(true);
    expect(v.code).toBe("phase-ok");
  });

  test("blocks a feature branch in the canonical main checkout", () => {
    const v = evaluateBranchPolicy({
      currentRoot: "/repo/gxpm/",
      currentBranch: "gxpm-27-main-branch-guard",
      canonicalMainRoot: "/repo/gxpm",
      env: {},
    });

    expect(v.allowed).toBe(false);
    expect(v.code).toBe("main-worktree-non-main");
  });

  test("treats trailing separators as the same worktree path", () => {
    const v = evaluateBranchPolicy({
      currentRoot: "/repo/gxpm-worktrees/gxpm-27-main-branch-guard/",
      currentBranch: "gxpm-27-main-branch-guard",
      canonicalMainRoot: "/repo/gxpm/",
      allowedWorktreeRoot: "/repo/gxpm-worktrees/",
      env: {},
    });

    expect(v.allowed).toBe(true);
    expect(v.code).toBe("phase-ok");
  });

  test("allows a feature branch in an allowed worktree root", () => {
    const v = evaluateBranchPolicy({
      currentRoot: "/repo/gxpm-worktrees/gxpm-27-main-branch-guard",
      currentBranch: "gxpm-27-main-branch-guard",
      canonicalMainRoot: "/repo/gxpm",
      allowedWorktreeRoot: "/repo/gxpm-worktrees",
      env: {},
    });

    expect(v.allowed).toBe(true);
    expect(v.code).toBe("phase-ok");
  });

  test("blocks a feature branch outside the allowed worktree root", () => {
    const v = evaluateBranchPolicy({
      currentRoot: "/tmp/gxpm-copy",
      currentBranch: "gxpm-27-main-branch-guard",
      canonicalMainRoot: "/repo/gxpm",
      allowedWorktreeRoot: "/repo/gxpm-worktrees",
      env: {},
    });

    expect(v.allowed).toBe(false);
    expect(v.code).toBe("feature-branch-outside-worktree-root");
  });

  test("respects GXPM_GATE_DISABLE env", () => {
    const v = evaluateBranchPolicy({
      currentRoot: "/repo/gxpm",
      currentBranch: "gxpm-27-main-branch-guard",
      canonicalMainRoot: "/repo/gxpm",
      env: { GXPM_GATE_DISABLE: "1" },
    });

    expect(v.allowed).toBe(true);
    expect(v.code).toBe("disabled");
  });
});

describe("evaluateCommitMsg", () => {
  test("blocks message without GXG/GXPM ref", () => {
    const v = evaluateCommitMsg("fix: random change", stateAt("implement"), {});
    expect(v.allowed).toBe(false);
    expect(v.code).toBe("missing-issue-ref");
  });

  test("allows when message contains GXG-123", () => {
    const v = evaluateCommitMsg("feat(api): handle X (GXG-123)", stateAt("implement"), {});
    expect(v.allowed).toBe(true);
  });

  test("allows when message contains GXPM-50", () => {
    const v = evaluateCommitMsg("chore: bump GXPM-50", stateAt("implement"), {});
    expect(v.allowed).toBe(true);
  });

  test("disable env bypasses commit-msg gate", () => {
    const v = evaluateCommitMsg("anything", stateAt("triage"), { GXPM_GATE_DISABLE: "1" });
    expect(v.allowed).toBe(true);
  });
});

describe("evaluatePrePush", () => {
  test("blocks when current phase requires artifact and it's missing", () => {
    const has = (_id: string, _t: string) => false;
    const v = evaluatePrePush(stateAt("dispatch"), has, {});
    expect(v.allowed).toBe(false);
    expect(v.code).toBe("missing-artifact");
  });

  test("allows when required artifact exists", () => {
    const has = (_id: string, t: string) => t === "dispatch-handoff";
    const v = evaluatePrePush(stateAt("dispatch"), has, {});
    expect(v.allowed).toBe(true);
  });

  test("allows when current phase has no outbound artifact requirement", () => {
    const has = () => false;
    const v = evaluatePrePush(stateAt("land"), has, {});
    expect(v.allowed).toBe(true);
    expect(v.code).toBe("phase-ok");
  });

  test("disable env bypasses pre-push gate", () => {
    const has = () => false;
    const v = evaluatePrePush(stateAt("dispatch"), has, { GXPM_GATE_DISABLE: "1" });
    expect(v.allowed).toBe(true);
    expect(v.code).toBe("disabled");
  });
});

describe("evaluatePostMerge", () => {
  test("returns transitionTo=land for phase=qa", () => {
    const v = evaluatePostMerge(stateAt("qa"));
    expect(v.transitionTo).toBe("land");
  });

  test("returns null for phases that should not auto-transition on merge", () => {
    const v = evaluatePostMerge(stateAt("triage"));
    expect(v.transitionTo).toBeNull();
  });

  test("returns null for phase=land (already landed)", () => {
    const v = evaluatePostMerge(stateAt("land"));
    expect(v.transitionTo).toBeNull();
  });
});
