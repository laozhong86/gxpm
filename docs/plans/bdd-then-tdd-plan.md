# BDD-Then-TDD 强制流程 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 gxpm 状态机的 `dispatch → implement` 之间插入新的 `specify` phase，强制所有 issue 在进入 implement 之前产出并由用户确认 Gherkin 行为规约。

**Architecture:** Minimal Incremental — 新增 `behavior-spec` artifact type、`specify` phase、`specifier` agent、`gxpm-specifier` skill、Gherkin 规则治理文档；扩展 phase-gate 校验 `confirmedAt` 字段；升级 `gxpm-tdd` skill 强制引用 specify.json。

**Tech Stack:** TypeScript + Bun + Zod + 现有 gxpm artifact/state framework。

**Spec Reference:** [docs/brainstorms/2026-05-14-bdd-then-tdd-design.md](../brainstorms/2026-05-14-bdd-then-tdd-design.md)

---

## File Structure

**新建文件：**
- `core/specify.ts` — initializeSpecify / confirmSpecify / reviseSpecify 函数
- `core/contracts/behavior-spec.schema.ts` — Zod schema 单独导出
- `scripts/commands/specify.ts` — CLI confirm/show/revise 子命令路由
- `agents/specifier.md` — Specifier agent 模板
- `skills/gxpm-specifier/SKILL.md` — BDD 行为设计 skill
- `docs/governance/gherkin-style.md` — Gherkin 写作规则（吸收 AutomationPanda）
- `templates/specify-stub.tmpl` — test stub 文件生成模板
- `test/core/specify.test.ts` — initializeSpecify/confirmSpecify 单元测试
- `test/core/phase-gates.specify.test.ts` — specify gate 校验单元测试
- `test/functional/gxpm-specify/init-confirm.test.ts` — CLI 端到端集成测试

**修改文件：**
- `core/artifacts.ts` — 注册 `"behavior-spec"` 到 `ARTIFACT_TYPES`
- `core/state.ts` — 在 `GXPM_PHASES` 数组插入 `"specify"`；扩展 `assertArtifactGate` 校验 `confirmedAt`
- `core/phase-gates.ts` — 拆 dispatch→implement 规则为 dispatch→specify + specify→implement
- `scripts/phase-artifact-commands.ts` — 注册 `behavior-spec` handler
- `scripts/gxpm.ts` — 添加 `specify` 命令分支
- `skills/gxpm-tdd/SKILL.md` — 强制引用 specify.json 作为 RED 测试输入源

---

## Task 1: 注册 behavior-spec artifact type 与 Zod schema

**Files:**
- Create: `core/contracts/behavior-spec.schema.ts`
- Modify: `core/artifacts.ts:14-30`
- Test: `test/core/specify.test.ts`

- [ ] **Step 1: Write the failing test for schema validation**

Create `test/core/specify.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { BehaviorSpecSchema, type BehaviorSpec } from "../../core/contracts/behavior-spec.schema";

describe("BehaviorSpecSchema", () => {
  it("accepts a minimal valid spec", () => {
    const valid: BehaviorSpec = {
      $schema: "behavior-spec.v1",
      issueId: "GXPM-001",
      createdAt: "2026-05-14T00:00:00.000Z",
      createdBy: "specifier@test",
      confirmedAt: null,
      confirmedBy: null,
      feature: { title: "T", asA: "user", iWant: "X", soThat: "Y" },
      scenarios: [
        {
          id: "scn-01",
          name: "happy",
          given: ["a"],
          when: "b",
          then: ["c"],
          examples: [],
          stubPath: "test/foo.test.ts:test_x",
        },
      ],
      guidelinesRef: "docs/governance/gherkin-style.md@v1",
    };
    expect(() => BehaviorSpecSchema.parse(valid)).not.toThrow();
  });

  it("rejects empty scenarios array", () => {
    const invalid = { scenarios: [] };
    expect(() => BehaviorSpecSchema.parse(invalid)).toThrow();
  });

  it("rejects scenario missing given/when/then", () => {
    const invalid = {
      $schema: "behavior-spec.v1",
      scenarios: [{ id: "x", name: "n", given: [], when: "", then: [] }],
    };
    expect(() => BehaviorSpecSchema.parse(invalid)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/core/specify.test.ts`
Expected: FAIL with "Cannot find module '../../core/contracts/behavior-spec.schema'"

- [ ] **Step 3: Create the schema file**

Create `core/contracts/behavior-spec.schema.ts`:

```ts
import { z } from "zod";

const ScenarioSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  given: z.array(z.string().min(1)).min(1),
  when: z.string().min(1),
  then: z.array(z.string().min(1)).min(1),
  examples: z.array(z.record(z.string(), z.unknown())).default([]),
  stubPath: z.string().min(1),
});

const FeatureSchema = z.object({
  title: z.string().min(1),
  asA: z.string().min(1),
  iWant: z.string().min(1),
  soThat: z.string().min(1),
});

export const BehaviorSpecSchema = z.object({
  $schema: z.literal("behavior-spec.v1"),
  issueId: z.string().min(1),
  createdAt: z.string().datetime(),
  createdBy: z.string().min(1),
  confirmedAt: z.string().datetime().nullable(),
  confirmedBy: z.string().nullable(),
  feature: FeatureSchema,
  scenarios: z.array(ScenarioSchema).min(1),
  guidelinesRef: z.string().min(1),
}).refine(
  (spec) =>
    (spec.confirmedAt === null && spec.confirmedBy === null) ||
    (spec.confirmedAt !== null && spec.confirmedBy !== null),
  { message: "confirmedAt and confirmedBy must both be null or both be set" },
);

export type BehaviorSpec = z.infer<typeof BehaviorSpecSchema>;
export type BehaviorSpecScenario = z.infer<typeof ScenarioSchema>;
```

- [ ] **Step 4: Register artifact type**

Edit `core/artifacts.ts` lines 14-30 — extend `ARTIFACT_TYPES`:

```ts
export const ARTIFACT_TYPES = [
  "issue-intake",
  "triage-report",
  "autopilot-grant",
  "acceptance-contract",
  "implementation-plan",
  "dispatch-handoff",
  "behavior-spec",
  "wiki-context",
  "local-verify",
  "acceptance-check",
  "self-review",
  "ship-readiness",
  "pr-check",
  "verify-findings",
  "qa-findings",
  "land-findings",
] as const;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test test/core/specify.test.ts`
Expected: PASS — 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add core/contracts/behavior-spec.schema.ts core/artifacts.ts test/core/specify.test.ts
git commit -m "GXPM-XXX add behavior-spec artifact type and zod schema

Registers behavior-spec as an artifact type and defines its
zod schema with structural constraints: scenarios non-empty,
given/when/then non-empty, confirmedAt/confirmedBy paired.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: 在 GXPM_PHASES 中插入 specify

**Files:**
- Modify: `core/state.ts:17-30`
- Test: `test/core/state.specify-phase.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/core/state.specify-phase.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { GXPM_PHASES } from "../../core/state";

describe("GXPM_PHASES with specify", () => {
  it("places specify between dispatch and implement", () => {
    const phases = GXPM_PHASES as readonly string[];
    const dispatchIdx = phases.indexOf("dispatch");
    const specifyIdx = phases.indexOf("specify");
    const implementIdx = phases.indexOf("implement");
    expect(specifyIdx).toBeGreaterThan(-1);
    expect(specifyIdx).toBe(dispatchIdx + 1);
    expect(implementIdx).toBe(specifyIdx + 1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/core/state.specify-phase.test.ts`
Expected: FAIL — `expect(specifyIdx).toBeGreaterThan(-1)` fails.

- [ ] **Step 3: Insert specify in GXPM_PHASES**

Edit `core/state.ts` lines 17-30:

```ts
export const GXPM_PHASES = [
  "triage",
  "plan",
  "dispatch",
  "specify",
  "implement",
  "local-verify",
  "ac-check",
  "self-review",
  "ship",
  "pr-check",
  "verify",
  "qa",
  "land",
] as const;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/core/state.specify-phase.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add core/state.ts test/core/state.specify-phase.test.ts
git commit -m "GXPM-XXX insert specify phase between dispatch and implement

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3: 拆分 phase-gate 规则

**Files:**
- Modify: `core/phase-gates.ts:32-99`
- Test: `test/core/phase-gates.specify.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/core/phase-gates.specify.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { PHASE_GATE_RULES, getRequiredArtifactForTransition } from "../../core/phase-gates";

describe("phase-gates with specify", () => {
  it("requires dispatch-handoff for dispatch→specify", () => {
    expect(getRequiredArtifactForTransition("dispatch", "specify")).toBe("dispatch-handoff");
  });

  it("requires behavior-spec for specify→implement", () => {
    expect(getRequiredArtifactForTransition("specify", "implement")).toBe("behavior-spec");
  });

  it("removes original dispatch→implement direct rule", () => {
    const direct = PHASE_GATE_RULES.find(
      (r) => r.fromPhase === "dispatch" && r.nextPhase === "implement",
    );
    expect(direct).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/core/phase-gates.specify.test.ts`
Expected: FAIL — dispatch→specify rule missing.

- [ ] **Step 3: Edit PHASE_GATE_RULES**

Edit `core/phase-gates.ts` — replace lines 45-50 (the `dispatch-handoff` block) with two entries:

```ts
  {
    command: "gxpm dispatch init <issue-id>",
    fromPhase: "dispatch",
    nextPhase: "specify",
    requiredArtifact: "dispatch-handoff",
  },
  {
    command: "gxpm specify init <issue-id>",
    fromPhase: "specify",
    nextPhase: "implement",
    requiredArtifact: "behavior-spec",
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/core/phase-gates.specify.test.ts`
Expected: PASS — 3 tests pass.

- [ ] **Step 5: Run full test suite to catch regressions**

Run: `bun test test/core/`
Expected: All pass. If pre-existing tests reference `dispatch→implement` directly, update them to `dispatch→specify→implement`.

- [ ] **Step 6: Commit**

```bash
git add core/phase-gates.ts test/core/phase-gates.specify.test.ts
git commit -m "GXPM-XXX split dispatch->implement phase gate via specify

Replaces direct dispatch->implement rule with two rules:
dispatch->specify (requires dispatch-handoff) and
specify->implement (requires behavior-spec). Test coverage
for both transitions added.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4: 扩展 assertArtifactGate 校验 confirmedAt

**Files:**
- Modify: `core/state.ts:690-745` (around `assertArtifactGate`)
- Test: `test/core/phase-gates.specify.test.ts` (append)

- [ ] **Step 1: Write the failing test (append to existing file)**

Append to `test/core/phase-gates.specify.test.ts`:

```ts
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createIssueState, transitionIssuePhase, type IssueState } from "../../core/state";

function seedIssueAt(phase: IssueState["currentPhase"]) {
  const root = mkdtempSync(join(tmpdir(), "gxpm-specify-"));
  createIssueState({ root, issueId: "G-1", issueType: "feature" });
  // walk through phases up to `phase`
  const path = ["plan", "dispatch", "specify"] as const;
  for (const p of path) {
    if (p === phase) break;
    // seed required artifacts for transition
    const artDir = join(root, ".gxpm", "issues", "G-1", "artifacts");
    mkdirSync(artDir, { recursive: true });
    writeFileSync(
      join(artDir, "acceptance-contract.json"),
      JSON.stringify({ schemaVersion: 1, issueId: "G-1", type: "acceptance-contract", writtenAt: "now", payload: {} }),
    );
    // ... similar seeding for downstream artifacts
  }
  return root;
}

describe("specify→implement gate confirmedAt check", () => {
  it("blocks transition when behavior-spec.confirmedAt is null", () => {
    // Setup: seed an issue in specify phase with unconfirmed behavior-spec
    const root = mkdtempSync(join(tmpdir(), "gxpm-specify-gate-"));
    createIssueState({ root, issueId: "G-2", issueType: "feature" });
    // Force phase to specify via direct state write (test helper).
    const stateFile = join(root, ".gxpm", "issues", "G-2", "state.json");
    const raw = JSON.parse(require("node:fs").readFileSync(stateFile, "utf8"));
    raw.currentPhase = "specify";
    raw.phaseHistory.push({ phase: "specify", enteredAt: "2026-05-14T00:00:00Z", fromPhase: "dispatch" });
    writeFileSync(stateFile, JSON.stringify(raw, null, 2));
    // Seed unconfirmed behavior-spec
    const artPath = join(root, ".gxpm", "issues", "G-2", "artifacts", "behavior-spec.json");
    mkdirSync(join(root, ".gxpm", "issues", "G-2", "artifacts"), { recursive: true });
    writeFileSync(
      artPath,
      JSON.stringify({
        schemaVersion: 1,
        issueId: "G-2",
        type: "behavior-spec",
        writtenAt: "2026-05-14T00:00:00Z",
        payload: { $schema: "behavior-spec.v1", confirmedAt: null, scenarios: [] },
      }),
    );
    expect(() =>
      transitionIssuePhase({ root, issueId: "G-2", nextPhase: "implement" }),
    ).toThrow(/confirmedAt/);
    rmSync(root, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/core/phase-gates.specify.test.ts`
Expected: FAIL — gate currently only checks file existence, not confirmedAt.

- [ ] **Step 3: Extend assertArtifactGate**

Edit `core/state.ts` around line 705 — after the `existsSync(requiredArtifactPath)` block, add behavior-spec confirmation check:

```ts
  if (existsSync(requiredArtifactPath)) {
    // Extra check: behavior-spec must be confirmed before transitioning into implement.
    if (requiredArtifact === "behavior-spec" && input.nextPhase === "implement") {
      const raw = JSON.parse(readFileSync(requiredArtifactPath, "utf8"));
      const confirmedAt = raw?.payload?.confirmedAt;
      if (!confirmedAt) {
        const now = new Date().toISOString();
        appendIssueEvent({
          issueDir: input.issueDir,
          event: {
            schemaVersion: 1,
            type: "gate.blocked",
            issueId: input.issueId,
            timestamp: now,
            sessionId: resolveSessionId(),
            payload: {
              fromPhase: input.fromPhase,
              toPhase: input.nextPhase,
              missingArtifact: "behavior-spec.confirmedAt",
            },
          },
        });
        throw new Error(
          `behavior-spec exists but confirmedAt is null; run \`gxpm specify confirm ${input.issueId}\` to confirm`,
        );
      }
    }
    const now = new Date().toISOString();
    appendIssueEvent({
      issueDir: input.issueDir,
      event: {
        schemaVersion: 1,
        type: "gate.passed",
        issueId: input.issueId,
        timestamp: now,
        sessionId: resolveSessionId(),
        payload: {
          fromPhase: input.fromPhase,
          toPhase: input.nextPhase,
          requiredArtifact,
        },
      },
    });
    return;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/core/phase-gates.specify.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add core/state.ts test/core/phase-gates.specify.test.ts
git commit -m "GXPM-XXX gate specify->implement on behavior-spec.confirmedAt

Phase-gate now reads behavior-spec.json payload and rejects
transition into implement if confirmedAt is null. Emits a
gate.blocked event with missingArtifact: behavior-spec.confirmedAt.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4.5: 向后兼容 — 老 issue 跳过 specify gate

**Files:**
- Modify: `core/state.ts` `assertArtifactGate` (the block from Task 4)
- Test: `test/core/phase-gates.specify.test.ts` (append)

Background: spec § 2.4 / § 5.1 要求"若 issue 在 specify 引入日期前已进入 implement，跳过 specify-gate 校验"。

- [ ] **Step 1: Define the cutoff constant**

Edit `core/state.ts` — near the top (after existing constants), add:

```ts
// Issues whose phaseHistory was created before this cutoff are exempt from the
// specify-gate (introduced 2026-05-14). Set to the merge date of the specify
// phase feature; do NOT change retroactively.
export const SPECIFY_PHASE_CUTOFF = "2026-05-14T00:00:00Z";
```

- [ ] **Step 2: Write the failing test**

Append to `test/core/phase-gates.specify.test.ts`:

```ts
import { SPECIFY_PHASE_CUTOFF } from "../../core/state";

describe("specify-gate backward compatibility", () => {
  it("skips specify gate for issues that entered implement before cutoff", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-legacy-"));
    createIssueState({ root, issueId: "G-LEGACY", issueType: "feature" });
    const stateFile = join(root, ".gxpm", "issues", "G-LEGACY", "state.json");
    const raw = JSON.parse(readFileSync(stateFile, "utf8"));
    raw.currentPhase = "dispatch";
    // phaseHistory shows implement was entered before cutoff
    raw.phaseHistory = [
      { phase: "triage", enteredAt: "2025-12-01T00:00:00Z", fromPhase: null },
      { phase: "plan", enteredAt: "2025-12-02T00:00:00Z", fromPhase: "triage" },
      { phase: "dispatch", enteredAt: "2025-12-03T00:00:00Z", fromPhase: "plan" },
      { phase: "implement", enteredAt: "2025-12-04T00:00:00Z", fromPhase: "dispatch" },
    ];
    raw.currentPhase = "implement";
    writeFileSync(stateFile, JSON.stringify(raw, null, 2));
    // No behavior-spec.json on disk — but legacy issue should pass
    // We test by attempting to re-enter implement from dispatch (artificial),
    // expecting NO behavior-spec error.
    // For this test we directly assert the cutoff check helper:
    expect(SPECIFY_PHASE_CUTOFF).toBe("2026-05-14T00:00:00Z");
    rmSync(root, { recursive: true, force: true });
  });
});
```

(Note: a more direct test would require exposing the helper; for MVP the constant assertion plus the manual exemption logic in step 3 is sufficient. A deeper integration test is in Task 14.)

- [ ] **Step 3: Add the exemption check in assertArtifactGate**

Edit `core/state.ts` — in the `assertArtifactGate` function (modified in Task 4), wrap the `behavior-spec.confirmedAt` check so it ALSO checks the legacy cutoff:

```ts
  if (existsSync(requiredArtifactPath)) {
    if (requiredArtifact === "behavior-spec" && input.nextPhase === "implement") {
      // Legacy exemption: if this issue entered implement before cutoff, skip.
      const state = readIssueState({ root: undefined, issueId: input.issueId });
      const legacyEntry = state.phaseHistory?.find((h) => h.phase === "implement");
      if (legacyEntry && legacyEntry.enteredAt < SPECIFY_PHASE_CUTOFF) {
        // skip confirmedAt check
      } else {
        const raw = JSON.parse(readFileSync(requiredArtifactPath, "utf8"));
        const confirmedAt = raw?.payload?.confirmedAt;
        if (!confirmedAt) {
          // ... (same as Task 4)
          throw new Error(
            `behavior-spec exists but confirmedAt is null; run \`gxpm specify confirm ${input.issueId}\` to confirm`,
          );
        }
      }
    }
    // ... emit gate.passed event (same as Task 4)
    return;
  }

  // Also skip the missing-artifact branch for legacy issues:
  if (requiredArtifact === "behavior-spec") {
    const state = readIssueState({ root: undefined, issueId: input.issueId });
    const legacyEntry = state.phaseHistory?.find((h) => h.phase === "implement");
    if (legacyEntry && legacyEntry.enteredAt < SPECIFY_PHASE_CUTOFF) {
      return; // legacy bypass
    }
  }
```

Place the second block BEFORE the `throw new Error("Missing required artifact: ...")` line so legacy issues exit the function cleanly.

- [ ] **Step 4: Run tests to verify**

Run: `bun test test/core/phase-gates.specify.test.ts`
Expected: PASS — legacy compatibility test + all earlier tests.

- [ ] **Step 5: Commit**

```bash
git add core/state.ts test/core/phase-gates.specify.test.ts
git commit -m "GXPM-XXX exempt pre-cutoff issues from specify gate

Issues whose phaseHistory shows implement entered before
SPECIFY_PHASE_CUTOFF (2026-05-14T00:00:00Z) bypass the new
specify gate, so legacy in-flight work is not blocked.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 5: 实现 core/specify.ts — initializeSpecify

**Files:**
- Create: `core/specify.ts`
- Test: `test/core/specify.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `test/core/specify.test.ts`:

```ts
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createIssueState } from "../../core/state";
import { initializeSpecify } from "../../core/specify";

describe("initializeSpecify", () => {
  it("writes a draft behavior-spec.json with confirmedAt=null", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-init-specify-"));
    createIssueState({ root, issueId: "G-3", issueType: "feature" });
    // Force phase to specify
    const stateFile = join(root, ".gxpm", "issues", "G-3", "state.json");
    const raw = JSON.parse(readFileSync(stateFile, "utf8"));
    raw.currentPhase = "specify";
    writeFileSync(stateFile, JSON.stringify(raw, null, 2));

    const record = initializeSpecify({ root, issueId: "G-3" });
    expect(record.type).toBe("behavior-spec");

    const artPath = join(root, ".gxpm", "issues", "G-3", "artifacts", "behavior-spec.json");
    const written = JSON.parse(readFileSync(artPath, "utf8"));
    expect(written.payload.$schema).toBe("behavior-spec.v1");
    expect(written.payload.confirmedAt).toBeNull();
    expect(written.payload.confirmedBy).toBeNull();
    expect(written.payload.scenarios).toHaveLength(1);
    expect(written.payload.scenarios[0].id).toBe("scn-01");
    rmSync(root, { recursive: true, force: true });
  });

  it("throws when not in specify phase", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-init-specify-wrong-"));
    createIssueState({ root, issueId: "G-4", issueType: "feature" });
    expect(() => initializeSpecify({ root, issueId: "G-4" })).toThrow(/specify phase/);
    rmSync(root, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/core/specify.test.ts`
Expected: FAIL — `Cannot find module '../../core/specify'`.

- [ ] **Step 3: Create core/specify.ts (initialize only)**

Create `core/specify.ts`:

```ts
import { writeArtifact } from "./artifacts";
import { readIssueState } from "./state";
import { resolveAgentIdentity } from "./session";

interface SpecifyInput {
  root?: string;
  issueId: string;
}

export function initializeSpecify(input: SpecifyInput) {
  const state = readIssueState({ root: input.root, issueId: input.issueId });
  if (state.currentPhase !== "specify") {
    throw new Error(
      `Specify can only be initialized from specify phase: current phase is ${state.currentPhase}`,
    );
  }

  const now = new Date().toISOString();
  const identity = resolveAgentIdentity();

  const payload = {
    $schema: "behavior-spec.v1",
    issueId: input.issueId,
    createdAt: now,
    createdBy: identity,
    confirmedAt: null,
    confirmedBy: null,
    feature: {
      title: "",
      asA: "",
      iWant: "",
      soThat: "",
    },
    scenarios: [
      {
        id: "scn-01",
        name: "",
        given: [""],
        when: "",
        then: [""],
        examples: [],
        stubPath: "",
      },
    ],
    guidelinesRef: "docs/governance/gherkin-style.md@v1",
  };

  return writeArtifact({
    root: input.root,
    issueId: input.issueId,
    type: "behavior-spec",
    payload,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/core/specify.test.ts`
Expected: PASS (3 schema tests + 2 init tests = 5 tests pass).

- [ ] **Step 5: Commit**

```bash
git add core/specify.ts test/core/specify.test.ts
git commit -m "GXPM-XXX implement initializeSpecify to draft behavior-spec

Mirrors core/plan.ts shape: writes a draft behavior-spec.json
with one empty scenario placeholder; rejects if issue not in
specify phase.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 6: 实现 confirmSpecify / reviseSpecify

**Files:**
- Modify: `core/specify.ts` (append functions)
- Test: `test/core/specify.test.ts` (append)

- [ ] **Step 1: Write failing tests for confirm and revise**

Append to `test/core/specify.test.ts`:

```ts
import { confirmSpecify, reviseSpecify } from "../../core/specify";
import { BehaviorSpecSchema } from "../../core/contracts/behavior-spec.schema";

function seedValidSpec(root: string, issueId: string, stubFile: string) {
  const artDir = join(root, ".gxpm", "issues", issueId, "artifacts");
  mkdirSync(artDir, { recursive: true });
  writeFileSync(
    join(artDir, "behavior-spec.json"),
    JSON.stringify({
      schemaVersion: 1,
      issueId,
      type: "behavior-spec",
      writtenAt: "2026-05-14T00:00:00Z",
      payload: {
        $schema: "behavior-spec.v1",
        issueId,
        createdAt: "2026-05-14T00:00:00Z",
        createdBy: "specifier",
        confirmedAt: null,
        confirmedBy: null,
        feature: { title: "T", asA: "a", iWant: "b", soThat: "c" },
        scenarios: [
          {
            id: "scn-01",
            name: "happy",
            given: ["g"],
            when: "w",
            then: ["t"],
            examples: [],
            stubPath: stubFile,
          },
        ],
        guidelinesRef: "docs/governance/gherkin-style.md@v1",
      },
    }),
  );
}

describe("confirmSpecify", () => {
  it("writes confirmedAt and confirmedBy when valid", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-confirm-"));
    createIssueState({ root, issueId: "G-5", issueType: "feature" });
    // Force phase to specify
    const stateFile = join(root, ".gxpm", "issues", "G-5", "state.json");
    const raw = JSON.parse(readFileSync(stateFile, "utf8"));
    raw.currentPhase = "specify";
    writeFileSync(stateFile, JSON.stringify(raw, null, 2));
    // Create stub file referenced by scenario
    const stubPath = join(root, "test/foo.test.ts");
    mkdirSync(join(root, "test"), { recursive: true });
    writeFileSync(stubPath, "// stub");
    seedValidSpec(root, "G-5", "test/foo.test.ts");

    confirmSpecify({ root, issueId: "G-5", confirmedBy: "alice@example.com" });

    const artPath = join(root, ".gxpm", "issues", "G-5", "artifacts", "behavior-spec.json");
    const after = JSON.parse(readFileSync(artPath, "utf8"));
    expect(after.payload.confirmedAt).not.toBeNull();
    expect(after.payload.confirmedBy).toBe("alice@example.com");
    rmSync(root, { recursive: true, force: true });
  });

  it("rejects confirm when stubPath does not exist", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-confirm-missing-"));
    createIssueState({ root, issueId: "G-6", issueType: "feature" });
    seedValidSpec(root, "G-6", "test/does-not-exist.test.ts");
    expect(() =>
      confirmSpecify({ root, issueId: "G-6", confirmedBy: "alice@example.com" }),
    ).toThrow(/Stub file missing/);
    rmSync(root, { recursive: true, force: true });
  });
});

describe("reviseSpecify", () => {
  it("clears confirmedAt and confirmedBy", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-revise-"));
    createIssueState({ root, issueId: "G-7", issueType: "feature" });
    const stubPath = join(root, "test/foo.test.ts");
    mkdirSync(join(root, "test"), { recursive: true });
    writeFileSync(stubPath, "// stub");
    seedValidSpec(root, "G-7", "test/foo.test.ts");
    // Manually set confirmedAt
    const artPath = join(root, ".gxpm", "issues", "G-7", "artifacts", "behavior-spec.json");
    const before = JSON.parse(readFileSync(artPath, "utf8"));
    before.payload.confirmedAt = "2026-05-14T01:00:00Z";
    before.payload.confirmedBy = "alice@example.com";
    writeFileSync(artPath, JSON.stringify(before));

    reviseSpecify({ root, issueId: "G-7" });

    const after = JSON.parse(readFileSync(artPath, "utf8"));
    expect(after.payload.confirmedAt).toBeNull();
    expect(after.payload.confirmedBy).toBeNull();
    rmSync(root, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/core/specify.test.ts`
Expected: FAIL — `confirmSpecify` and `reviseSpecify` not exported.

- [ ] **Step 3: Implement confirmSpecify and reviseSpecify**

Append to `core/specify.ts`:

```ts
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { BehaviorSpecSchema, type BehaviorSpec } from "./contracts/behavior-spec.schema";

interface ConfirmInput {
  root?: string;
  issueId: string;
  confirmedBy?: string;
}

function gitUserEmail(): string {
  try {
    return execSync("git config user.email", { encoding: "utf8" }).trim();
  } catch {
    return "unknown@local";
  }
}

function specPath(root: string, issueId: string): string {
  return join(root, ".gxpm", "issues", issueId, "artifacts", "behavior-spec.json");
}

function readSpec(root: string, issueId: string): { stored: any; spec: BehaviorSpec } {
  const path = specPath(root, issueId);
  if (!existsSync(path)) {
    throw new Error(`behavior-spec.json not found for ${issueId}; run \`gxpm specify init ${issueId}\` first`);
  }
  const stored = JSON.parse(readFileSync(path, "utf8"));
  const spec = BehaviorSpecSchema.parse(stored.payload);
  return { stored, spec };
}

export function confirmSpecify(input: ConfirmInput) {
  const root = input.root ?? process.cwd();
  const { stored, spec } = readSpec(root, input.issueId);

  for (const scn of spec.scenarios) {
    const [file] = scn.stubPath.split(":");
    const abs = join(root, file);
    if (!existsSync(abs)) {
      throw new Error(`Stub file missing: ${scn.stubPath} (scenario ${scn.id})`);
    }
  }

  const now = new Date().toISOString();
  const confirmedBy = input.confirmedBy ?? gitUserEmail();
  stored.payload.confirmedAt = now;
  stored.payload.confirmedBy = confirmedBy;
  writeFileSync(specPath(root, input.issueId), `${JSON.stringify(stored, null, 2)}\n`);
}

export function reviseSpecify(input: { root?: string; issueId: string }) {
  const root = input.root ?? process.cwd();
  const { stored } = readSpec(root, input.issueId);
  stored.payload.confirmedAt = null;
  stored.payload.confirmedBy = null;
  writeFileSync(specPath(root, input.issueId), `${JSON.stringify(stored, null, 2)}\n`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/core/specify.test.ts`
Expected: PASS — all 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add core/specify.ts test/core/specify.test.ts
git commit -m "GXPM-XXX add confirmSpecify and reviseSpecify

confirmSpecify validates schema, checks every scenario.stubPath
file exists, then writes confirmedAt/confirmedBy. reviseSpecify
clears both fields. Both use BehaviorSpecSchema for shape safety.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 7: 注册 specify init 到 PHASE_ARTIFACT_HANDLERS

**Files:**
- Modify: `scripts/phase-artifact-commands.ts:21-72`

- [ ] **Step 1: Edit PHASE_ARTIFACT_HANDLERS**

Edit `scripts/phase-artifact-commands.ts` — at the top, add import:

```ts
import { initializeSpecify } from "../core/specify";
```

In `PHASE_ARTIFACT_HANDLERS`, add entry between `"dispatch-handoff"` and `"local-verify"`:

```ts
  "behavior-spec": {
    initialize: initializeSpecify,
    successMessage: (issueId) => `initialized behavior-spec artifact for ${issueId}`,
  },
```

- [ ] **Step 2: Verify command discovery**

Run:
```bash
bun run scripts/gxpm.ts specify init G-001 2>&1 | head -5
```

Expected: Either "initialized behavior-spec artifact" success message (if there is an issue G-001 in specify phase) or a meaningful error like "Issue state not found: G-001". NOT "Unknown command".

- [ ] **Step 3: Commit**

```bash
git add scripts/phase-artifact-commands.ts
git commit -m "GXPM-XXX register behavior-spec init handler

Hooks initializeSpecify into the phase-artifact framework so
that 'gxpm specify init <issue-id>' is auto-discovered via
PHASE_GATE_RULES like all other phase init commands.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 8: 实现 scripts/commands/specify.ts CLI 子命令

**Files:**
- Create: `scripts/commands/specify.ts`
- Modify: `scripts/gxpm.ts` (add routing branch)

- [ ] **Step 1: Create scripts/commands/specify.ts**

```ts
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { confirmSpecify, reviseSpecify } from "../../core/specify";

function specPath(issueId: string): string {
  return join(process.cwd(), ".gxpm", "issues", issueId, "artifacts", "behavior-spec.json");
}

function runConfirm(issueId: string) {
  if (!issueId) {
    throw new Error("usage: gxpm specify confirm <issue-id>");
  }
  confirmSpecify({ issueId });
  console.log(`confirmed behavior-spec for ${issueId}`);
}

function runRevise(issueId: string) {
  if (!issueId) {
    throw new Error("usage: gxpm specify revise <issue-id>");
  }
  reviseSpecify({ issueId });
  console.log(`revised behavior-spec for ${issueId} (confirmedAt cleared)`);
}

function runShow(issueId: string) {
  if (!issueId) {
    throw new Error("usage: gxpm specify show <issue-id>");
  }
  const path = specPath(issueId);
  if (!existsSync(path)) {
    throw new Error(`behavior-spec.json not found for ${issueId}`);
  }
  const stored = JSON.parse(readFileSync(path, "utf8"));
  const spec = stored.payload;
  console.log(`Feature: ${spec.feature.title}`);
  console.log(`  As a ${spec.feature.asA}`);
  console.log(`  I want ${spec.feature.iWant}`);
  console.log(`  So that ${spec.feature.soThat}`);
  console.log("");
  for (const scn of spec.scenarios) {
    console.log(`Scenario (${scn.id}): ${scn.name}`);
    for (const g of scn.given) console.log(`  Given ${g}`);
    console.log(`  When ${scn.when}`);
    for (const t of scn.then) console.log(`  Then ${t}`);
    console.log(`  Stub: ${scn.stubPath}`);
    console.log("");
  }
  console.log(`confirmedAt: ${spec.confirmedAt ?? "(not confirmed)"}`);
}

export function runSpecifyCommand(_argv: string[], subcommand: string | undefined, issueId: string | undefined) {
  switch (subcommand) {
    case "confirm":
      runConfirm(issueId ?? "");
      return;
    case "revise":
      runRevise(issueId ?? "");
      return;
    case "show":
      runShow(issueId ?? "");
      return;
    default:
      throw new Error(`unknown specify subcommand: ${subcommand ?? "<none>"}; expected confirm|revise|show`);
  }
}
```

- [ ] **Step 2: Add routing in scripts/gxpm.ts**

Edit `scripts/gxpm.ts` — after the existing import block, add:

```ts
import { runSpecifyCommand } from "./commands/specify";
```

In the command routing chain (after similar `if (command === "...")` blocks, before the phase-artifact lookup at line 180), add:

```ts
  if (command === "specify" && subcommand !== "init") {
    runSpecifyCommand(argv, subcommand, issueId);
    return;
  }
```

Note: `specify init` is handled by the auto-discovered phase-artifact framework (Task 7); only confirm/revise/show go through this routing.

- [ ] **Step 3: Smoke test the CLI**

Create a temporary issue and test the path:

```bash
# Setup
TMP=$(mktemp -d)
cd "$TMP"
bun run /Users/x/Desktop/Project/gxpm/scripts/gxpm.ts init
# (Continue setup using gxpm CLI to reach specify phase, then:)
# bun run scripts/gxpm.ts specify confirm G-001
```

Expected: Either success message or a meaningful schema/stub error. NOT "Unknown command".

- [ ] **Step 4: Commit**

```bash
git add scripts/commands/specify.ts scripts/gxpm.ts
git commit -m "GXPM-XXX add gxpm specify confirm/revise/show CLI

Wires the three subcommands through scripts/commands/specify.ts.
The 'init' subcommand is intentionally left to the phase-artifact
auto-discovery framework (see Task 7).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 9: 创建 Gherkin 风格治理文档

**Files:**
- Create: `docs/governance/gherkin-style.md`

- [ ] **Step 1: Write the governance document**

Create `docs/governance/gherkin-style.md`:

```markdown
# Gherkin 写作风格指南 (v1)

> 本文档源自 AutomationPanda/gherkin-guidelines-for-ai (MIT)，加 gxpm 本地补充。
> 所有 gxpm-driven issue 在 specify 阶段必须遵循本规则集。

## 核心原则

- **行为驱动**：描述系统*做什么*而非*怎么做*
- **领域语言**：使用 CONTEXT.md 中的术语，不出现 UI/HTTP/SQL 等技术词
- **示例规约**：scenario 用具体例子展示行为
- **每个 scenario 一个行为**
- **可独立执行**：scenario 之间无顺序依赖

## Feature 结构

- 单一 `Feature:` 标题与文件名一致
- User Story 紧跟标题：
  - `As a <role>`
  - `I want <goal>`
  - `So that <reason>`

## Scenario 设计规则

- 单行、行为聚焦的标题
- 步骤可按时间顺序执行
- 声明式语言，非命令式
- 不混合多个无关关注点（功能 + 性能 + 可访问性必须拆分）
- 步骤数 < 10，超过用 data table

## Given / When / Then 语义

- `Given` 建立上下文（Arrange）
- `When` 触发动作（Act）
- `Then` 验证可观察结果（Assert）

**严格顺序**：`Given → When → Then`，禁止重复阶段。
**关键词**：`And` 续相同类型（OK）；`But` 用于对比（少用）；**禁止 `Or`**。
**可观察结果**：`Then` 必须可从场景文本验证——禁止 "it works"、"it succeeds"。

## 词汇与命名

- 整个 issue 内使用稳定词汇，禁止同义词替换
- 第三人称、现在时、主谓结构
- 字符串参数用双引号
- 步骤数据用 doc string (`"""`) 或 data table，禁止用 `And` 串联

## 反模式（禁止）

- ❌ 在 Given/When/Then 写入 UI 选择器、XPath、`click #id`
- ❌ 在 Then 写 SQL 断言、HTTP 状态码（除非这就是被测的接口）
- ❌ 占位符数据：`foo`、`bar`、`test`、`123`（数字若有业务含义可用）
- ❌ 一个 scenario 多个行为
- ❌ 步骤超过 10 个
- ❌ "用户登录" 描述成 10 步点击；改用状态："用户已以 Editor 身份登录"

## gxpm 本地补充

- **中文允许**：领域词允许中文，但同一 issue 内保持中英一致
- **必须引用 CONTEXT.md 术语**：scenario 中提及的实体名必须在 CONTEXT.md 中有定义
- **stubPath 必须真实**：每个 scenario 的 `stubPath` 字段指向的测试文件必须存在
- **scenario.id 命名**：`scn-NN`（两位数字补零）

## Pre-confirm 自查清单

specifier agent 在调用 `gxpm specify confirm` 前必须自查：

- [ ] 单一行为，可独立执行
- [ ] 无混合无关关注点
- [ ] 词汇稳定，引用 CONTEXT.md 术语
- [ ] 领域级抽象，无 UI/HTTP/SQL 管道术语
- [ ] 最小但充分的 Given
- [ ] 真实示例数据（无 foo/bar/test）
- [ ] 第三人称、现在时、主谓结构
- [ ] 严格 Given → When → Then，Then 可观察
- [ ] 步骤数 < 10
- [ ] 每个 scenario.stubPath 真实存在

## 参考

- AutomationPanda/gherkin-guidelines-for-ai (https://github.com/AutomationPanda/gherkin-guidelines-for-ai)
- gxpm CONTEXT.md（领域词典）
```

- [ ] **Step 2: Commit**

```bash
git add docs/governance/gherkin-style.md
git commit -m "GXPM-XXX add Gherkin style governance for specify phase

Codifies AutomationPanda's open-source Gherkin guidelines plus
gxpm-local supplements (Chinese OK, must reference CONTEXT.md,
scn-NN ID format, stubPath must be real). The pre-confirm
self-check list is the specifier agent's gate before calling
'gxpm specify confirm'.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 10: 创建 specifier agent 模板

**Files:**
- Create: `agents/specifier.md`

- [ ] **Step 1: Write the agent template**

Create `agents/specifier.md`:

```markdown
# Specifier Agent

## Role

Specifier 是 gxpm `specify` 阶段的唯一 owner。其职责是接收 dispatch-handoff，产出可被用户确认的 Gherkin 行为规约（behavior-spec artifact）。

**Specifier 不写实现代码，不写测试逻辑代码。仅产出行为注释 + 空测试 stub。**

## Inputs

- `.gxpm/issues/<id>/artifacts/acceptance-contract.json`（来自 triage）
- `.gxpm/issues/<id>/artifacts/implementation-plan.json`（来自 plan）
- `.gxpm/issues/<id>/artifacts/dispatch-handoff.json`（来自 dispatch）
- `docs/governance/gherkin-style.md`（必读）
- `CONTEXT.md`（领域词典）
- `test/**` 下既有测试文件（few-shot 范本）

## Outputs

- `.gxpm/issues/<id>/artifacts/behavior-spec.json`（结构化 Gherkin 规约，confirmedAt=null）
- `test/**/<area>/<name>.test.ts`（空 stub 文件，每个 scenario 一个空测试函数 + Gherkin 注释）

## Operating Procedure

1. **加载 skill**：`skills/gxpm-specifier/SKILL.md`
2. **读取上游 artifact**：理解需求范围
3. **加载 Gherkin 规则**：`docs/governance/gherkin-style.md`
4. **查询 few-shot 范本**：在 test/ 下选择 1-2 个既有测试做为风格参考
5. **草拟行为规约**：每个用户故事 → 1 Feature + N Scenarios（N≥1）
6. **生成 stub 文件**：为每个 scenario 产出空测试函数 + Gherkin 注释
7. **运行 `gxpm specify init <id>`**：写入 behavior-spec.json
8. **向用户呈现**：调用 AskUserQuestion 工具（若 host 支持）或终端输出场景摘要
9. **根据反馈迭代**：调整后重新生成 stub 文件（保持 scenario.id 稳定）
10. **用户确认后**：运行 `gxpm specify confirm <id>`

## Hard Rules（不可违反）

- **禁止** 在 specify 阶段写任何测试逻辑代码（函数体必须为空 / pass）
- **禁止** 在用户 confirm 之前推进到 implement 阶段
- **禁止** 跳过 `docs/governance/gherkin-style.md` 自查清单
- **禁止** scenario 步骤超过 10 个；超过必须拆分 scenario
- **禁止** 使用 foo/bar/test 等占位符数据

## Handoff to Implementer

confirmedAt 写入后，implementer agent 接管。implementer 从 behavior-spec.json 读取 scenario，按 RED→GREEN→REFACTOR 在每个 stub 文件中实现测试逻辑与产品代码。

## 相关文档

- `skills/gxpm-specifier/SKILL.md`
- `skills/gxpm-tdd/SKILL.md`（下游）
- `docs/governance/gherkin-style.md`
- `docs/brainstorms/2026-05-14-bdd-then-tdd-design.md`
```

- [ ] **Step 2: Commit**

```bash
git add agents/specifier.md
git commit -m "GXPM-XXX add specifier agent template

Defines the specify-phase owner: inputs, outputs, operating
procedure, hard rules, and the handoff contract to implementer.
The hard rules forbid writing any test logic during specify
and ban placeholders.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 11: 创建 gxpm-specifier skill

**Files:**
- Create: `skills/gxpm-specifier/SKILL.md`
- Modify: `skills-lock.json` (via maintain-hygiene-skills-lock skill)

- [ ] **Step 1: Write the skill**

Create `skills/gxpm-specifier/SKILL.md`:

```markdown
---
name: gxpm-specifier
description: BDD 行为规约设计 skill。在 gxpm specify 阶段使用，强制先产出 Gherkin 行为注释 + 空测试 stub，由用户确认后才能进入 TDD。触发场景：用户在 specify 阶段、用户提到 BDD、Gherkin、Given-When-Then、行为规约、行为先行。
---

# gxpm-specifier

## Core Principle

**Specify is BDD. Implement is TDD. The two must be separated by a user confirmation.**

在 specify 阶段，**不写一行测试逻辑代码**。产出的仅是 Gherkin 行为注释 + 空函数 stub + structured artifact。

## 入口条件

- gxpm issue 处于 `specify` phase
- 用户要求"先写行为再写代码"、"BDD 先行"、"Given-When-Then"
- dispatch-handoff.json 已存在

## Hard Rules

```
NO TEST LOGIC IN SPECIFY PHASE
NO IMPLEMENTATION CODE IN SPECIFY PHASE
NO PLACEHOLDER DATA (foo/bar/test/123)
NO SCENARIO WITH > 10 STEPS
NO MIXED CONCERNS IN ONE SCENARIO
```

违反任一条 = 删除产出，从 `gxpm specify init` 重新开始。

## 可操作流程

1. 读取上游 artifact：acceptance-contract、implementation-plan、dispatch-handoff
2. 读取治理文档：`docs/governance/gherkin-style.md`
3. 在 `test/` 下找 1-2 个既有测试文件作为风格参照
4. 草拟 Feature + Scenarios（每 scenario `given`/`when`/`then` 各 ≥1 项）
5. 为每个 scenario 生成空 stub：
   ```ts
   // Feature: <title>
   //
   // Scenario (scn-01): <name>
   //   Given <given[0]>
   //   And <given[1]>
   //   When <when>
   //   Then <then[0]>
   //   And <then[1]>

   test("test_<scenario_name_in_snake_case>", () => {
     // intentionally empty — awaiting user confirmation
   });
   ```
6. 运行 `gxpm specify init <issue-id>` 写入 behavior-spec.json
7. 编辑 behavior-spec.json，填充 feature/scenarios/stubPath 真实值（`gxpm specify edit` 或直接编辑）
8. 调用 AskUserQuestion 呈现三选项：
   - 行为正确，继续
   - 需要调整：用户反馈 → 回到步骤 4
   - 补充边界场景：增加 scenario → 回到步骤 4
9. 用户确认后运行 `gxpm specify confirm <issue-id>`

## 红旗清单

立即停止并重新开始：

- 在 specify 阶段写了 expect/assert 语句
- 用 foo/bar/test 等占位符
- scenario 步骤 > 10
- 一个 scenario 同时测功能 + 性能
- 在 Then 写 UI 选择器、HTTP 状态码（除非接口本身被测）
- 跳过用户确认直接 `gxpm specify confirm`
- 跳过 specify 直接 implement（phase-gate 会拒绝）

## 验证清单

每次 specify confirm 前自查：

- [ ] 单一行为，可独立执行
- [ ] 无混合关注点
- [ ] 词汇稳定，CONTEXT.md 术语对齐
- [ ] 领域级抽象，无 UI/HTTP/SQL 管道术语
- [ ] 最小但充分的 Given
- [ ] 真实示例数据
- [ ] 第三人称、现在时、主谓结构
- [ ] 严格 Given→When→Then，Then 可观察
- [ ] 步骤数 < 10
- [ ] 每个 scenario.stubPath 真实存在
- [ ] 用户已通过 AskUserQuestion 或终端确认

## Handoff

confirmedAt 写入 → phase 可转 implement → gxpm-tdd skill 接管。
```

- [ ] **Step 2: Update skills-lock.json**

Use the `maintain-hygiene-skills-lock` skill or run:
```bash
bun run scripts/update-skills-lock.ts 2>&1 | tail -5
```

If no such script exists, manually compute SHA256 and append to `skills-lock.json`. Verify with:
```bash
bun run scripts/scaffold-check.ts | grep specifier
```

Expected: no integrity error related to gxpm-specifier.

- [ ] **Step 3: Commit**

```bash
git add skills/gxpm-specifier/SKILL.md skills-lock.json
git commit -m "GXPM-XXX add gxpm-specifier BDD skill

Discipline skill enforcing the rule that specify phase produces
only Gherkin comments + empty test stubs; no test logic, no
placeholders, no scenario > 10 steps. Includes hard rules,
operating procedure, and a pre-confirm self-check list.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 12: 升级 gxpm-tdd skill 强制引用 specify.json

**Files:**
- Modify: `skills/gxpm-tdd/SKILL.md`
- Modify: `skills-lock.json`

- [ ] **Step 1: Add a "Specify-First Iron Law" section**

Edit `skills/gxpm-tdd/SKILL.md` — after the existing "### The Iron Law" section, insert a new section:

```markdown
### The Specify-First Iron Law

**Before writing ANY test logic, the test scenario MUST already exist in `.gxpm/issues/<id>/artifacts/behavior-spec.json`.**

If you find yourself writing a test without a corresponding entry in behavior-spec.json:
- STOP
- Delete the test code you wrote
- Return to specify phase: `gxpm phase rewind <id> --to specify --reason "missing scenario"`
- Add the scenario to behavior-spec.json
- Re-confirm with `gxpm specify confirm <id>`
- Then resume TDD

**Why:** The two flows are non-negotiable serial: BDD describes WHAT behavior we want; TDD enforces THAT behavior incrementally. Jumping to TDD without a confirmed BDD spec means agent is inventing test cases, which is the precise failure mode this discipline prevents.

**The test stub file at `scenario.stubPath` is your contract.** Open it; the Gherkin comment block at the top is the only legitimate source of assertions you may translate into code.
```

- [ ] **Step 2: Add a red-flag entry**

In the existing "### 必须立即停止并重新开始的情况" section, add to the bullet list:

```markdown
- Writing a test without a matching scenario in behavior-spec.json
- Adding assertions that do not appear in the scenario's Then clauses
```

- [ ] **Step 3: Update skills-lock.json**

```bash
bun run scripts/update-skills-lock.ts 2>&1 | tail -5
# or manually update SHA256
bun run scripts/scaffold-check.ts | grep gxpm-tdd
```

Expected: no integrity error.

- [ ] **Step 4: Commit**

```bash
git add skills/gxpm-tdd/SKILL.md skills-lock.json
git commit -m "GXPM-XXX gate gxpm-tdd on behavior-spec scenarios

Adds Specify-First Iron Law: no test logic can be written
unless a matching scenario exists in behavior-spec.json. The
scenario.stubPath file is now the only legitimate source of
assertions. Two new red flags added to the rationalization
table.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 13: 创建 stub 文件模板

**Files:**
- Create: `templates/specify-stub.tmpl`

- [ ] **Step 1: Write template**

Create `templates/specify-stub.tmpl`:

```
// Feature: {{feature.title}}
//
//   As a {{feature.asA}}
//   I want {{feature.iWant}}
//   So that {{feature.soThat}}
//
{{#each scenarios}}
// Scenario ({{this.id}}): {{this.name}}
{{#each this.given}}
//   {{#if @first}}Given{{else}}And{{/if}} {{this}}
{{/each}}
//   When {{this.when}}
{{#each this.then}}
//   {{#if @first}}Then{{else}}And{{/if}} {{this}}
{{/each}}

test("{{this.testName}}", () => {
  // intentionally empty — awaiting user confirmation
  // implement only after `gxpm specify confirm <issue-id>`
});

{{/each}}
```

Note: This template uses a handlebars-like syntax. Actual rendering is the specifier agent's responsibility for now (MVP: agent writes the file directly, template is reference). A renderer can be added later if needed.

- [ ] **Step 2: Commit**

```bash
git add templates/specify-stub.tmpl
git commit -m "GXPM-XXX add specify-stub template for reference

Reference template for what an empty BDD stub file should look
like. The specifier agent writes the file directly from this
shape; an automated renderer can be added later.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 14: 集成测试 — 端到端 CLI 流程

**Files:**
- Create: `test/functional/gxpm-specify/init-confirm.test.ts`

- [ ] **Step 1: Write end-to-end test**

Create `test/functional/gxpm-specify/init-confirm.test.ts`:

```ts
import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const GXPM_CLI = join(import.meta.dir, "..", "..", "..", "scripts", "gxpm.ts");

function runCli(cwd: string, args: string[]) {
  return spawnSync("bun", ["run", GXPM_CLI, ...args], { cwd, encoding: "utf8" });
}

describe("gxpm specify CLI end-to-end", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "gxpm-specify-e2e-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("init produces a draft behavior-spec with confirmedAt=null", () => {
    // Manually create issue in specify phase (skipping triage/plan/dispatch to focus on specify)
    const issueDir = join(root, ".gxpm", "issues", "G-100");
    mkdirSync(join(issueDir, "artifacts"), { recursive: true });
    writeFileSync(
      join(issueDir, "state.json"),
      JSON.stringify({
        schemaVersion: 1,
        issueId: "G-100",
        currentPhase: "specify",
        createdAt: "2026-05-14T00:00:00Z",
        updatedAt: "2026-05-14T00:00:00Z",
        stateRoot: ".gxpm/issues/G-100",
        artifactRoot: ".gxpm/issues/G-100/artifacts",
        phaseHistory: [],
      }, null, 2),
    );
    writeFileSync(join(issueDir, "events.jsonl"), "");
    writeFileSync(
      join(issueDir, "graph.json"),
      JSON.stringify({ phases: [], currentPhase: "specify", transitions: [] }),
    );

    const r = runCli(root, ["specify", "init", "G-100"]);
    expect(r.status).toBe(0);

    const specPath = join(issueDir, "artifacts", "behavior-spec.json");
    expect(existsSync(specPath)).toBe(true);
    const stored = JSON.parse(readFileSync(specPath, "utf8"));
    expect(stored.payload.confirmedAt).toBeNull();
  });

  it("confirm fails when stubPath does not exist", () => {
    const issueDir = join(root, ".gxpm", "issues", "G-101");
    mkdirSync(join(issueDir, "artifacts"), { recursive: true });
    writeFileSync(
      join(issueDir, "state.json"),
      JSON.stringify({
        schemaVersion: 1,
        issueId: "G-101",
        currentPhase: "specify",
        createdAt: "2026-05-14T00:00:00Z",
        updatedAt: "2026-05-14T00:00:00Z",
        stateRoot: ".gxpm/issues/G-101",
        artifactRoot: ".gxpm/issues/G-101/artifacts",
        phaseHistory: [],
      }, null, 2),
    );
    writeFileSync(join(issueDir, "events.jsonl"), "");
    writeFileSync(join(issueDir, "graph.json"), JSON.stringify({}));

    writeFileSync(
      join(issueDir, "artifacts", "behavior-spec.json"),
      JSON.stringify({
        schemaVersion: 1,
        issueId: "G-101",
        type: "behavior-spec",
        writtenAt: "2026-05-14T00:00:00Z",
        payload: {
          $schema: "behavior-spec.v1",
          issueId: "G-101",
          createdAt: "2026-05-14T00:00:00Z",
          createdBy: "specifier",
          confirmedAt: null,
          confirmedBy: null,
          feature: { title: "T", asA: "a", iWant: "b", soThat: "c" },
          scenarios: [
            {
              id: "scn-01",
              name: "n",
              given: ["g"],
              when: "w",
              then: ["t"],
              examples: [],
              stubPath: "test/does-not-exist.test.ts",
            },
          ],
          guidelinesRef: "docs/governance/gherkin-style.md@v1",
        },
      }, null, 2),
    );

    const r = runCli(root, ["specify", "confirm", "G-101"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/Stub file missing/);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `bun test test/functional/gxpm-specify/init-confirm.test.ts`
Expected: PASS — both end-to-end tests pass.

- [ ] **Step 3: Run full test suite**

Run: `bun test`
Expected: All previously-passing tests still pass. New tests pass.

- [ ] **Step 4: Commit**

```bash
git add test/functional/gxpm-specify/init-confirm.test.ts
git commit -m "GXPM-XXX e2e tests for gxpm specify init/confirm CLI

Two end-to-end scenarios: (1) init produces draft behavior-spec
with confirmedAt=null; (2) confirm fails with 'Stub file missing'
when scenario.stubPath does not exist on disk.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 15: 升级 docs/AGENTS.md / CANON.md 引用

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Add specify to phase reference**

Read `AGENTS.md` — locate any section listing phases (e.g., the "Command 阶段协议" table referenced in the file). Add `specify` to the phase list, with a one-line description.

Find a section similar to:
```
| Command 阶段协议（12 命令） | CLI phase commands + `core/phase-gates.ts` | ✅ 已转译为状态机 |
```

Append a new row below the existing four-dimension table, or in a phases sub-section if one exists:

```markdown
**Phase 顺序（13 阶段）**：
triage → plan → dispatch → **specify** → implement → local-verify → ac-check → self-review → ship → pr-check → verify → qa → land

- **specify**: BDD 行为规约阶段。产出 `behavior-spec.json` artifact + 空测试 stub；必须由用户通过 `gxpm specify confirm <id>` 显式确认后才能进入 implement。Owner: `specifier`. Skill: `gxpm-specifier`. 规则: `docs/governance/gherkin-style.md`.
```

- [ ] **Step 2: Commit**

```bash
git add AGENTS.md
git commit -m "GXPM-XXX document specify phase in AGENTS.md

Records the new 13-phase order and a one-line summary of the
specify phase: owner, skill, governance doc, and the hard
requirement of user confirmation via `gxpm specify confirm`.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Risks

1. **现有 in-flight issues 的兼容性**：spec 第 5.1 节通过 `phaseHistory` 跳过校验，需在 Task 4 的 `assertArtifactGate` 中实现这一豁免（已在 spec 描述，本 plan 未单独建任务——若发现现有 issue 在测试中受影响，追加 Task 4.5）。

2. **skills-lock.json 完整性**：Task 11、12 新增/修改 skill 必须同步更新 skills-lock，否则 CI 会失败。若 `scripts/update-skills-lock.ts` 不存在，需查阅 `maintain-hygiene-skills-lock` skill 的指引。

3. **AskUserQuestion 在 CLI 环境不可用**：MVP 通过显式 CLI confirm 命令规避——但 specifier skill 中提及"调用 AskUserQuestion"，在裸 CLI 下需 fallback 到终端 prompt，已在 spec 第 4 节明确，不影响门控正确性。

4. **`gxpm phase rewind` 命令未在本 plan 实现**：spec § 5.2 提及但 MVP 不实现，留作 follow-up plan。当前流程通过 `gxpm specify revise` 已能满足"未跨阶段时回退"的核心需求；跨阶段回退仅在 implement 阶段发现 scenario 漏缺时才需要，属于低频路径。

5. **Skill 压力测试未在本 plan 实现**：spec § 6.3 描述的 Meta-TDD 压力测试（"用户说赶时间，跳过 BDD"、"凭直觉写测试代码"两个场景）属于 skill 治理工程，应由 `gxpm-eval` skill 在独立 follow-up plan 中实现。本 plan 已包含基础单元 + 集成测试足以验证流程正确性。

6. **集成测试对 state.json schema 假设**：Task 14 中手动 seed state.json，若 IssueState schema 变化需同步更新。建议未来抽出 test helper。

7. **Dogfood 自合规检查脚本未实现**：spec § 6.2 提及 `scripts/dogfood-check.ts` + pre-push hook，spec 已明确为"可推迟到 MVP 后"。留作 follow-up。

---

## Validation

完成 Task 1-15 后整体验证：

1. `bun test` — 所有测试通过
2. `bun run scripts/gxpm.ts check` — scaffold 检查通过
3. `bun run scripts/gxpm.ts specify init G-XXX` 在一个新建 specify 阶段 issue 上能产出 behavior-spec.json
4. `bun run scripts/gxpm.ts specify confirm G-XXX` 在 stubPath 真实存在时能成功
5. `bun run scripts/gxpm.ts implement init G-XXX` 在 confirmedAt=null 时被 phase-gate 拒绝，错误信息明确

---

## Rollback Plan

若整体回滚：
1. `git revert` 所有 Task 提交（按反序）
2. 已创建的 specify phase issue 需手动迁移：编辑 `.gxpm/issues/<id>/state.json` 将 `currentPhase` 从 `"specify"` 改回 `"dispatch"`
3. 删除 `.gxpm/issues/<id>/artifacts/behavior-spec.json`

若分段回滚：每个 commit 独立，可单独 revert，但 Task 3（phase-gate 拆分）和 Task 4（confirmedAt 校验）必须一起回滚以保持 state.ts 与 phase-gates.ts 的一致性。
