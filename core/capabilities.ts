import { type ArtifactType } from "./artifacts";
import { type ErrorType } from "./resilience";

export const CAPABILITY_STATUSES = ["active", "planned"] as const;
export type CapabilityStatus = (typeof CAPABILITY_STATUSES)[number];

export const CAPABILITY_RUNTIMES = [
  "issue",
  "execution",
  "verification",
  "release",
  "knowledge",
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
    title: "Native Wiki Context",
    summary: "Generates and selects first-party wiki context for an issue without depending on Qoder runtime.",
    runtime: "knowledge",
    status: "active",
    inputContract: "Repository git-tracked text files, wiki state, query text or issue id, phase, and limit.",
    outputContract: {
      description: "Wiki status/query/context results and optional issue wiki-context artifact.",
      artifacts: ["wiki-context"],
      evidence: [".gxpm/wiki/index/files.json", ".gxpm/wiki/index/graph.json", ".gxpm/wiki/content/*.md"],
    },
    mutationPolicy: {
      scope: "issue-local-files",
      description: "init/update mutate .gxpm/wiki; context --write-artifact writes only the target issue wiki-context artifact.",
    },
    idempotency: "Index/update are deterministic for the same git tree; context selection is deterministic for the same query and index.",
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
