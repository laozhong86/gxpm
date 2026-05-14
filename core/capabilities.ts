import { type ArtifactType } from "./artifacts";
import { type ErrorType } from "./resilience";

export const CAPABILITY_STATUSES = ["active", "planned"] as const;
export type CapabilityStatus = (typeof CAPABILITY_STATUSES)[number];

export const CAPABILITY_RUNTIMES = [
  "issue",
  "planning",
  "execution",
  "verification",
  "review",
  "browser",
  "release",
  "memory",
  "knowledge",
  "skill",
] as const;
export type CapabilityRuntime = (typeof CAPABILITY_RUNTIMES)[number];

export const CAPABILITY_MUTATION_SCOPES = [
  "none",
  "issue-state",
  "issue-local-files",
  "workspace-files",
  "external-provider",
] as const;
export type CapabilityMutationScope = (typeof CAPABILITY_MUTATION_SCOPES)[number];

export type CapabilityFailureMode =
  | string
  | { description: string; defaultType?: ErrorType };

export interface CapabilityContract {
  id: string;
  title: string;
  summary: string;
  runtime: CapabilityRuntime;
  status: CapabilityStatus;
  inputContract: string;
  outputContract: {
    description: string;
    artifacts: ArtifactType[];
    evidence: string[];
  };
  mutationPolicy: {
    scope: CapabilityMutationScope;
    description: string;
  };
  idempotency: string;
  failureModes: CapabilityFailureMode[];
  commands: string[];
  sourceFiles: string[];
}

export const CAPABILITY_REGISTRY = [
  {
    id: "issue.readiness",
    title: "Issue Readiness",
    summary: "Reports dispatchable, blocked, ignored, claimed, released, and stale issue states.",
    runtime: "issue",
    status: "active",
    inputContract: "Reads .gxpm issue state, phase, issue type, archive flag, and claim lifecycle metadata.",
    outputContract: {
      description: "Read-only readiness decisions for one or more issues.",
      artifacts: [],
      evidence: ["stdout table", "JSON readiness report"],
    },
    mutationPolicy: {
      scope: "none",
      description: "Read-only; must not write artifacts, claims, runs, or phase state.",
    },
    idempotency: "Repeated reads at the same state produce the same decision set.",
    failureModes: [
      { description: "Missing or malformed issue state", defaultType: "FATAL" },
      { description: "Unreadable .gxpm issue directory", defaultType: "TRANSIENT" },
    ],
    commands: ["gxpm issue ready [--all] [--json]"],
    sourceFiles: ["core/issue-readiness.ts", "scripts/commands/issue.ts"],
  },
  {
    id: "issue.claim-lifecycle",
    title: "Issue Claim Lifecycle",
    summary: "Claims, releases, and reconciles issue-local execution ownership.",
    runtime: "issue",
    status: "active",
    inputContract: "Issue id, current session id, optional actor/run id, release reason, and stale threshold.",
    outputContract: {
      description: "Issue claim state plus issue.claimed/released/stale timeline events.",
      artifacts: [],
      evidence: ["state.json claim field", "events.jsonl claim events", "JSON claim response"],
    },
    mutationPolicy: {
      scope: "issue-state",
      description: "May update only the target issue claim metadata and timeline events under .gxpm.",
    },
    idempotency: "Same-session claim is idempotent; release/reconcile only changes state when the claim is active or stale.",
    failureModes: [
      { description: "Issue already claimed by another session", defaultType: "FATAL" },
      { description: "Missing release reason", defaultType: "FATAL" },
      { description: "Invalid stale threshold", defaultType: "FATAL" },
    ],
    commands: [
      "gxpm issue claim <issue-id>",
      "gxpm issue release <issue-id>",
      "gxpm issue reconcile-claim <issue-id>",
    ],
    sourceFiles: ["core/issue-readiness.ts", "scripts/commands/issue.ts"],
  },
  {
    id: "planning.acceptance-contract",
    title: "Acceptance Contract",
    summary: "Initializes and records the triage contract that defines scope, criteria, risks, and affected capabilities.",
    runtime: "planning",
    status: "active",
    inputContract: "Issue id, triage findings, success criteria, non-goals, risks, and capability impact notes.",
    outputContract: {
      description: "acceptance-contract phase artifact and artifact timeline event.",
      artifacts: ["acceptance-contract"],
      evidence: ["artifacts/acceptance-contract.json", "events.jsonl artifact.written"],
    },
    mutationPolicy: {
      scope: "issue-local-files",
      description: "Writes only the target issue acceptance-contract artifact through the artifact store.",
    },
    idempotency: "Repeated initialization rewrites the same issue artifact without mutating unrelated state.",
    failureModes: [
      { description: "Current issue cannot enter plan because acceptance criteria are missing", defaultType: "FATAL" },
      { description: "Invalid acceptance-contract payload", defaultType: "FATAL" },
      { description: "Artifact store write failure", defaultType: "TRANSIENT" },
    ],
    commands: [
      "gxpm triage init <issue-id>",
      "gxpm artifact write <issue-id> acceptance-contract --json <json>",
    ],
    sourceFiles: [
      "core/triage.ts",
      "core/phase-gates.ts",
      "core/artifacts.ts",
      "scripts/phase-artifact-commands.ts",
      "scripts/commands/artifact.ts",
    ],
  },
  {
    id: "planning.implementation-plan",
    title: "Implementation Plan",
    summary: "Records the plan artifact that turns the acceptance contract into scoped implementation slices and validation.",
    runtime: "planning",
    status: "active",
    inputContract: "Issue id, acceptance-contract artifact, chosen approach, implementation steps, risks, and validation plan.",
    outputContract: {
      description: "implementation-plan phase artifact and artifact timeline event.",
      artifacts: ["implementation-plan"],
      evidence: ["artifacts/implementation-plan.json", "events.jsonl artifact.written"],
    },
    mutationPolicy: {
      scope: "issue-local-files",
      description: "Writes only the target issue implementation-plan artifact through the artifact store.",
    },
    idempotency: "Repeated initialization refreshes the same plan artifact for the current issue and phase.",
    failureModes: [
      { description: "Current phase is not plan", defaultType: "FATAL" },
      { description: "Plan lacks approach or validation contract", defaultType: "FATAL" },
      { description: "Artifact store write failure", defaultType: "TRANSIENT" },
    ],
    commands: [
      "gxpm plan init <issue-id>",
      "gxpm artifact write <issue-id> implementation-plan --json <json>",
    ],
    sourceFiles: [
      "core/plan.ts",
      "core/phase-gates.ts",
      "core/artifacts.ts",
      "scripts/phase-artifact-commands.ts",
      "scripts/commands/artifact.ts",
    ],
  },
  {
    id: "execution.run-ledger",
    title: "Run Ledger",
    summary: "Records issue-local execution attempts and append-only run events.",
    runtime: "execution",
    status: "active",
    inputContract: "Issue id, optional attempt/status/workspace/message, run id, event type, and optional claim actor.",
    outputContract: {
      description: "Run records stored under the issue runs directory.",
      artifacts: [],
      evidence: ["runs/run-*.json", "JSON run response", "stdout run status"],
    },
    mutationPolicy: {
      scope: "issue-local-files",
      description: "May create, update, or remove run ledger files for the target issue only.",
    },
    idempotency: "Run status/list reads are stable; run start creates one new attempt unless rolled back by failed --claim.",
    failureModes: [
      { description: "Unknown run id", defaultType: "FATAL" },
      { description: "Invalid run status", defaultType: "FATAL" },
      { description: "Claim refusal during --claim start", defaultType: "FATAL" },
    ],
    commands: [
      "gxpm run start <issue-id> [--claim]",
      "gxpm run list <issue-id>",
      "gxpm run status <issue-id> <run-id>",
      "gxpm run event <issue-id> <run-id> --type <event>",
    ],
    sourceFiles: ["core/runs.ts", "scripts/commands/runtime.ts"],
  },
  {
    id: "execution.workspace-runtime",
    title: "Workspace Runtime",
    summary: "Plans, creates, reuses, or removes issue-scoped filesystem workspaces.",
    runtime: "execution",
    status: "active",
    inputContract: "Issue id and optional workspace root, with path key derived from the issue identifier.",
    outputContract: {
      description: "Workspace path plan or mutation result.",
      artifacts: [],
      evidence: ["stdout workspace report", "JSON workspace report", "issue-scoped workspace directory"],
    },
    mutationPolicy: {
      scope: "workspace-files",
      description: "plan is read-only; ensure/cleanup may create or remove only the issue-derived workspace path.",
    },
    idempotency: "plan is pure; ensure reuses existing workspace; cleanup is a no-op when the workspace is absent.",
    failureModes: [
      { description: "Unsafe issue id for path derivation", defaultType: "FATAL" },
      { description: "Workspace path escapes configured root", defaultType: "FATAL" },
      { description: "Filesystem permission failure", defaultType: "TRANSIENT" },
    ],
    commands: [
      "gxpm workspace plan <issue-id>",
      "gxpm workspace ensure <issue-id>",
      "gxpm workspace cleanup <issue-id>",
    ],
    sourceFiles: ["core/workspace-runtime.ts", "scripts/commands/runtime.ts"],
  },
  {
    id: "execution.orchestrator-dry-run",
    title: "Orchestrator Dry Run",
    summary: "Reports dispatchability without claiming, creating workspaces, launching agents, or writing artifacts.",
    runtime: "execution",
    status: "active",
    inputContract: "Local issue state graph plus optional --include-all flag.",
    outputContract: {
      description: "Dispatchability summary and per-issue blocker reasons.",
      artifacts: [],
      evidence: ["stdout dry-run report", "JSON dry-run report"],
    },
    mutationPolicy: {
      scope: "none",
      description: "Strictly read-only; must not mutate issue state, artifacts, runs, claims, or workspaces.",
    },
    idempotency: "Repeated dry-runs at the same state produce the same report.",
    failureModes: [
      { description: "Malformed issue state", defaultType: "FATAL" },
      { description: "Unreadable issue directory", defaultType: "TRANSIENT" },
    ],
    commands: ["gxpm orchestrator tick --dry-run [--json] [--include-all]"],
    sourceFiles: ["core/orchestrator.ts", "scripts/commands/runtime.ts"],
  },
  {
    id: "execution.dispatch-handoff",
    title: "Dispatch Handoff",
    summary: "Converts the plan into worker tasks, validation expectations, stop rules, and worktree handoff metadata.",
    runtime: "execution",
    status: "active",
    inputContract: "Issue id plus acceptance-contract and implementation-plan artifacts.",
    outputContract: {
      description: "dispatch-handoff phase artifact and artifact timeline event.",
      artifacts: ["dispatch-handoff"],
      evidence: ["artifacts/dispatch-handoff.json", "events.jsonl artifact.written"],
    },
    mutationPolicy: {
      scope: "issue-local-files",
      description: "Writes only the target issue dispatch-handoff artifact through the artifact store.",
    },
    idempotency: "Repeated initialization derives the same handoff shape from the current plan artifacts.",
    failureModes: [
      { description: "Current phase is not dispatch", defaultType: "FATAL" },
      { description: "Plan artifact missing or incomplete", defaultType: "FATAL" },
      { description: "Artifact store write failure", defaultType: "TRANSIENT" },
    ],
    commands: [
      "gxpm dispatch init <issue-id>",
      "gxpm artifact write <issue-id> dispatch-handoff --json <json>",
    ],
    sourceFiles: [
      "core/dispatch.ts",
      "core/phase-gates.ts",
      "core/artifacts.ts",
      "scripts/phase-artifact-commands.ts",
      "scripts/commands/artifact.ts",
    ],
  },
  {
    id: "execution.behavior-spec",
    title: "Behavior Specification",
    summary: "Initializes and confirms the BDD-style behavior spec that gates the specify-to-implement transition.",
    runtime: "execution",
    status: "active",
    inputContract: "Issue id in specify phase; dispatch-handoff artifact must already exist.",
    outputContract: {
      description: "behavior-spec phase artifact with confirmedAt set, and artifact timeline event.",
      artifacts: ["behavior-spec"],
      evidence: ["artifacts/behavior-spec.json", "events.jsonl artifact.written"],
    },
    mutationPolicy: {
      scope: "issue-local-files",
      description: "Writes and confirms only the target issue behavior-spec artifact through the artifact store.",
    },
    idempotency: "Repeated initialization recreates the draft spec; confirm is idempotent once confirmed.",
    failureModes: [
      { description: "Current phase is not specify", defaultType: "FATAL" },
      { description: "Placeholder sentinels remain unfilled", defaultType: "FATAL" },
      { description: "Stub file referenced in scenario is missing", defaultType: "FATAL" },
      { description: "Artifact store write failure", defaultType: "TRANSIENT" },
    ],
    commands: [
      "gxpm specify init <issue-id>",
      "gxpm specify confirm <issue-id>",
    ],
    sourceFiles: [
      "core/specify.ts",
      "core/phase-gates.ts",
      "core/artifacts.ts",
      "scripts/phase-artifact-commands.ts",
      "scripts/commands/specify.ts",
    ],
  },
  {
    id: "verification.issue-evidence-store",
    title: "Issue Evidence Store",
    summary: "Allocates and writes issue-local command, browser, review, release, and investigation evidence.",
    runtime: "verification",
    status: "active",
    inputContract: "Issue id, evidence kind, safe filename, media type, and JSON/text/binary payload.",
    outputContract: {
      description: "Evidence records stored under the target issue evidence directory.",
      artifacts: [],
      evidence: [
        "evidence/command-logs/*",
        "evidence/browser-snapshots/*",
        "evidence/browser-screenshots/*",
        "evidence/investigations/*",
        "JSON evidence write record",
      ],
    },
    mutationPolicy: {
      scope: "issue-local-files",
      description: "May create or overwrite files only under the target issue evidence directory.",
    },
    idempotency: "Path allocation is deterministic for the same filename; repeated writes replace only that evidence file.",
    failureModes: [
      { description: "Invalid issue id", defaultType: "FATAL" },
      { description: "Unknown evidence kind", defaultType: "FATAL" },
      { description: "Unsafe evidence filename", defaultType: "FATAL" },
      { description: "Filesystem write failure", defaultType: "TRANSIENT" },
    ],
    commands: ["gxpm-investigate <issue-id> [--label <text>]"],
    sourceFiles: ["core/evidence.ts", "bin/gxpm-investigate"],
  },
  {
    id: "knowledge.wiki-context",
    title: "Optional Human Wiki",
    summary: "Generates optional first-party project docs for human onboarding and review; agents should use GitNexus for code intelligence.",
    runtime: "knowledge",
    status: "active",
    inputContract: "Repository git-tracked text files, optional wiki state, query text or issue id, phase, and limit.",
    outputContract: {
      description: "Human-readable wiki status/query/context results and optional issue wiki-context artifact.",
      artifacts: ["wiki-context"],
      evidence: [".gxpm/wiki/index/files.json", ".gxpm/wiki/index/graph.json", ".gxpm/wiki/content/*.md"],
    },
    mutationPolicy: {
      scope: "issue-local-files",
      description: "Manual init/update mutate .gxpm/wiki; context --write-artifact writes only the target issue wiki-context artifact.",
    },
    idempotency: "Manual index/update are deterministic for the same git tree; context selection is deterministic for the same query and index.",
    failureModes: [
      { description: "Missing native wiki state", defaultType: "FATAL" },
      { description: "Stale wiki index", defaultType: "TRANSIENT" },
      { description: "Unsupported binary or ignored files", defaultType: "FATAL" },
    ],
    commands: [
      "gxpm wiki init",
      "gxpm wiki update",
      "gxpm wiki status",
      "gxpm wiki query <text>",
      "gxpm wiki context <issue-id>",
    ],
    sourceFiles: ["core/wiki.ts", "scripts/commands/wiki.ts"],
  },
  {
    id: "verification.local-artifact",
    title: "Local Verification Artifact",
    summary: "Captures agent-owned local validation evidence before acceptance checking.",
    runtime: "verification",
    status: "active",
    inputContract: "Issue id plus JSON local verification payload produced after focused and broad checks.",
    outputContract: {
      description: "local-verify phase artifact and artifact timeline event.",
      artifacts: ["local-verify"],
      evidence: ["artifacts/local-verify.json", "events.jsonl artifact.written"],
    },
    mutationPolicy: {
      scope: "issue-local-files",
      description: "Writes only the target issue local-verify artifact through the artifact store.",
    },
    idempotency: "Repeated writes replace the local-verify artifact with the newest evidence while preserving timeline history.",
    failureModes: [
      { description: "Current phase cannot initialize local-verify", defaultType: "FATAL" },
      { description: "Invalid artifact payload", defaultType: "FATAL" },
      { description: "Command evidence missing", defaultType: "FATAL" },
    ],
    commands: ["gxpm implement verify <issue-id>", "gxpm artifact write <issue-id> local-verify --json <json>"],
    sourceFiles: ["core/implement.ts", "core/artifacts.ts"],
  },
  {
    id: "verification.acceptance-check",
    title: "Acceptance Check",
    summary: "Checks local verification against the acceptance contract before self-review.",
    runtime: "verification",
    status: "active",
    inputContract: "Issue id plus acceptance-contract, implementation-plan, and local-verify artifacts.",
    outputContract: {
      description: "acceptance-check phase artifact and artifact timeline event.",
      artifacts: ["acceptance-check"],
      evidence: ["artifacts/acceptance-check.json", "artifacts/local-verify.json", "events.jsonl artifact.written"],
    },
    mutationPolicy: {
      scope: "issue-local-files",
      description: "Writes only the target issue acceptance-check artifact through the artifact store.",
    },
    idempotency: "Repeated initialization refreshes draft check structure without changing the phase until transition.",
    failureModes: [
      { description: "Current phase is not local-verify", defaultType: "FATAL" },
      { description: "Acceptance criteria or local verification evidence missing", defaultType: "FATAL" },
      { description: "Artifact store write failure", defaultType: "TRANSIENT" },
    ],
    commands: [
      "gxpm local-verify ac-check <issue-id>",
      "gxpm artifact write <issue-id> acceptance-check --json <json>",
    ],
    sourceFiles: [
      "core/ac-check.ts",
      "core/phase-gates.ts",
      "core/artifacts.ts",
      "scripts/phase-artifact-commands.ts",
      "scripts/commands/artifact.ts",
    ],
  },
  {
    id: "review.self-review",
    title: "Self Review",
    summary: "Records the implementer self-review, residual risks, and plan-lint findings after acceptance checking.",
    runtime: "review",
    status: "active",
    inputContract: "Issue id plus acceptance-check and local-verify artifacts.",
    outputContract: {
      description: "self-review phase artifact and artifact timeline event.",
      artifacts: ["self-review"],
      evidence: ["artifacts/self-review.json", "artifacts/acceptance-check.json", "events.jsonl artifact.written"],
    },
    mutationPolicy: {
      scope: "issue-local-files",
      description: "Writes only the target issue self-review artifact through the artifact store.",
    },
    idempotency: "Repeated initialization reruns plan lint and replaces only the issue self-review artifact.",
    failureModes: [
      { description: "Current phase is not ac-check", defaultType: "FATAL" },
      { description: "Acceptance-check artifact missing or unresolved", defaultType: "FATAL" },
      { description: "Artifact store write failure", defaultType: "TRANSIENT" },
    ],
    commands: [
      "gxpm ac-check self-review <issue-id>",
      "gxpm artifact write <issue-id> self-review --json <json>",
    ],
    sourceFiles: [
      "core/self-review.ts",
      "core/phase-gates.ts",
      "core/artifacts.ts",
      "scripts/phase-artifact-commands.ts",
      "scripts/commands/artifact.ts",
    ],
  },
  {
    id: "release.ship-readiness",
    title: "Ship Readiness",
    summary: "Records release readiness, rollback plan, compatibility notes, and human verification expectations.",
    runtime: "release",
    status: "active",
    inputContract: "Issue id plus self-review, acceptance-check, and release readiness findings.",
    outputContract: {
      description: "ship-readiness phase artifact and artifact timeline event.",
      artifacts: ["ship-readiness"],
      evidence: ["artifacts/ship-readiness.json", "artifacts/self-review.json", "events.jsonl artifact.written"],
    },
    mutationPolicy: {
      scope: "issue-local-files",
      description: "Writes only the target issue ship-readiness artifact through the artifact store.",
    },
    idempotency: "Repeated initialization refreshes release readiness fields without mutating remote providers.",
    failureModes: [
      { description: "Current phase is not self-review", defaultType: "FATAL" },
      { description: "Rollback plan or checklist missing", defaultType: "FATAL" },
      { description: "Artifact store write failure", defaultType: "TRANSIENT" },
    ],
    commands: [
      "gxpm self-review ship <issue-id>",
      "gxpm artifact write <issue-id> ship-readiness --json <json>",
    ],
    sourceFiles: [
      "core/ship.ts",
      "core/phase-gates.ts",
      "core/artifacts.ts",
      "scripts/phase-artifact-commands.ts",
      "scripts/commands/artifact.ts",
    ],
  },
  {
    id: "release.pr-check",
    title: "PR Check Artifact",
    summary: "Captures PR, review, and release-readiness evidence before independent verification.",
    runtime: "release",
    status: "active",
    inputContract: "Issue id plus PR/check/review evidence gathered from local git and external providers.",
    outputContract: {
      description: "pr-check phase artifact and release gate evidence.",
      artifacts: ["pr-check"],
      evidence: ["artifacts/pr-check.json", "GitHub PR status", "CodeRabbit review status"],
    },
    mutationPolicy: {
      scope: "external-provider",
      description: "Artifact writes are local; external PR reads must not merge or mutate remote state.",
    },
    idempotency: "Repeated reads and artifact rewrites refresh evidence without changing phase unless transition is explicit.",
    failureModes: [
      { description: "PR unavailable", defaultType: "TRANSIENT" },
      { description: "Review pending or failed", defaultType: "FATAL" },
      { description: "Mergeability unknown", defaultType: "TRANSIENT" },
      { description: "Invalid artifact payload", defaultType: "FATAL" },
    ],
    commands: ["gxpm ship pr-check <issue-id>", "gxpm artifact write <issue-id> pr-check --json <json>"],
    sourceFiles: ["core/pr-check.ts", "scripts/commands/artifact.ts"],
  },
  {
    id: "verification.verify-findings",
    title: "Independent Verify Findings",
    summary: "Records post-PR independent verification findings and residual risks before browser QA.",
    runtime: "verification",
    status: "active",
    inputContract: "Issue id plus pr-check, acceptance-contract, local verification, and independent verification results.",
    outputContract: {
      description: "verify-findings phase artifact and artifact timeline event.",
      artifacts: ["verify-findings"],
      evidence: ["artifacts/verify-findings.json", "artifacts/pr-check.json", "events.jsonl artifact.written"],
    },
    mutationPolicy: {
      scope: "issue-local-files",
      description: "Writes only the target issue verify-findings artifact through the artifact store.",
    },
    idempotency: "Repeated initialization preserves the same verification artifact path and requires explicit transition for phase changes.",
    failureModes: [
      { description: "Current phase is not pr-check", defaultType: "FATAL" },
      { description: "PR check or verification evidence missing", defaultType: "FATAL" },
      { description: "Artifact store write failure", defaultType: "TRANSIENT" },
    ],
    commands: [
      "gxpm pr-check verify <issue-id>",
      "gxpm artifact write <issue-id> verify-findings --json <json>",
    ],
    sourceFiles: [
      "core/verify.ts",
      "core/phase-gates.ts",
      "core/artifacts.ts",
      "scripts/phase-artifact-commands.ts",
      "scripts/commands/artifact.ts",
    ],
  },
  {
    id: "browser.qa-findings",
    title: "Browser QA Findings",
    summary: "Records browser QA evidence, findings, and risks before land readiness.",
    runtime: "browser",
    status: "active",
    inputContract: "Issue id plus verify-findings and browser or manual QA evidence references.",
    outputContract: {
      description: "qa-findings phase artifact and browser evidence references.",
      artifacts: ["qa-findings"],
      evidence: [
        "artifacts/qa-findings.json",
        "evidence/browser-snapshots/*",
        "evidence/browser-screenshots/*",
        "events.jsonl artifact.written",
      ],
    },
    mutationPolicy: {
      scope: "issue-local-files",
      description: "Writes only the target issue qa-findings artifact and references issue-local browser evidence.",
    },
    idempotency: "Repeated initialization writes the same QA artifact path; raw browser evidence remains separately addressable.",
    failureModes: [
      { description: "Current phase is not verify", defaultType: "FATAL" },
      { description: "Required browser evidence is missing for a browser-facing acceptance criterion", defaultType: "FATAL" },
      { description: "Artifact store write failure", defaultType: "TRANSIENT" },
    ],
    commands: [
      "gxpm verify qa <issue-id>",
      "gxpm artifact write <issue-id> qa-findings --json <json>",
    ],
    sourceFiles: [
      "core/qa.ts",
      "core/phase-gates.ts",
      "core/artifacts.ts",
      "scripts/phase-artifact-commands.ts",
      "scripts/commands/artifact.ts",
    ],
  },
  {
    id: "release.land-findings",
    title: "Land Findings",
    summary: "Records land readiness, merge plan, release risks, and post-merge reconciliation metadata.",
    runtime: "release",
    status: "active",
    inputContract: "Issue id plus qa-findings, release risks, merge plan, and optional post-merge SHA.",
    outputContract: {
      description: "land-findings phase artifact and optional reconcile event after a successful merge.",
      artifacts: ["land-findings"],
      evidence: ["artifacts/land-findings.json", "events.jsonl artifact.written", "events.jsonl artifact.reconciled"],
    },
    mutationPolicy: {
      scope: "issue-local-files",
      description: "Writes only the target issue land-findings artifact; reconcile may archive the same issue after merge evidence.",
    },
    idempotency: "Initialization is repeatable; reconcile is idempotent for the same merged SHA.",
    failureModes: [
      { description: "Current phase is not qa or land for the requested action", defaultType: "FATAL" },
      { description: "QA findings or merge plan missing", defaultType: "FATAL" },
      { description: "Invalid merge SHA during reconcile", defaultType: "FATAL" },
      { description: "Artifact store write failure", defaultType: "TRANSIENT" },
    ],
    commands: [
      "gxpm qa land <issue-id>",
      "gxpm artifact write <issue-id> land-findings --json <json>",
    ],
    sourceFiles: [
      "core/land.ts",
      "core/phase-gates.ts",
      "core/artifacts.ts",
      "scripts/phase-artifact-commands.ts",
      "scripts/commands/artifact.ts",
    ],
  },
  {
    id: "execution.workflow-events",
    title: "Workflow Events",
    summary: "Typed event bus for gxpm execution observability with fire-and-forget semantics.",
    runtime: "execution",
    status: "active",
    inputContract: "Event listener functions or issue-scoped filters.",
    outputContract: {
      description: "Subscription handles and side-effect-free event emission.",
      artifacts: [],
      evidence: ["stderr event logs when --verbose-events is enabled"],
    },
    mutationPolicy: {
      scope: "none",
      description: "Emit is side-effect-free for listeners; subscribe is read-only on the emitter.",
    },
    idempotency: "Emitting the same event multiple times delivers to all active listeners each time.",
    failureModes: [
      { description: "Listener throws", defaultType: "FATAL" },
      { description: "Memory leak from uncleared subscriptions", defaultType: "FATAL" },
    ],
    commands: ["gxpm --verbose-events <command>"],
    sourceFiles: ["core/workflow-event-emitter.ts"],
  },
  {
    id: "execution.dag-run",
    title: "DAG Run",
    summary: "Execute a DAG workflow with topological ordering, concurrent layers, trigger rules, and when conditions.",
    runtime: "execution",
    status: "active",
    inputContract: "A validated WorkflowDefinition with DagNode array and an executor function.",
    outputContract: {
      description: "DagExecutionResult with success flag, node outputs map, and duration.",
      artifacts: [],
      evidence: ["stdout execution trace", "node output map"],
    },
    mutationPolicy: {
      scope: "none",
      description: "Execution is side-effect-free except for user-provided executor callbacks.",
    },
    idempotency: "Same inputs produce same topological ordering; executor side-effects are caller-responsible.",
    failureModes: [
      { description: "Cycle detected at runtime", defaultType: "FATAL" },
      { description: "Node executor throws", defaultType: "FATAL" },
      { description: "Abort signal triggered", defaultType: "TRANSIENT" },
    ],
    commands: ["gxpm dag run <workflow-file>"],
    sourceFiles: ["core/dag-executor.ts", "core/dag-loader.ts", "core/dag-schemas.ts"],
  },
  {
    id: "execution.dag-validate",
    title: "DAG Validate",
    summary: "Validate a workflow definition for structural correctness: unique IDs, dependency existence, cycle detection, and output reference integrity.",
    runtime: "execution",
    status: "active",
    inputContract: "A raw workflow object or YAML string.",
    outputContract: {
      description: "Parsed WorkflowDefinition or WorkflowLoadError with detailed message.",
      artifacts: [],
      evidence: ["stdout validation result"],
    },
    mutationPolicy: {
      scope: "none",
      description: "Read-only validation; no mutations.",
    },
    idempotency: "Repeated validation of the same input produces the same result.",
    failureModes: [
      { description: "Parse error", defaultType: "FATAL" },
      { description: "Validation error", defaultType: "FATAL" },
    ],
    commands: ["gxpm dag validate <workflow-file>"],
    sourceFiles: ["core/dag-loader.ts", "core/dag-schemas.ts"],
  },
] as const satisfies readonly CapabilityContract[];

export type CapabilityId = (typeof CAPABILITY_REGISTRY)[number]["id"];

export function listCapabilities() {
  return [...CAPABILITY_REGISTRY];
}

export function getCapability(id: string) {
  return CAPABILITY_REGISTRY.find((capability) => capability.id === id) ?? null;
}

export function requireCapability(id: string) {
  const capability = getCapability(id);
  if (!capability) {
    throw new Error(`Unknown capability: ${id}`);
  }
  return capability;
}
