import { readFileSync, writeFileSync } from "node:fs";
import {
  appendIssueEvent,
  assertValidPhase,
  getIssuePaths,
  readIssueState,
  type GxpmPhase,
} from "./state";
import { resolveSessionId } from "./session";

export interface RewindInput {
  root?: string;
  issueId: string;
  toPhase: GxpmPhase | string;
  reason: string;
}

export interface RewindResult {
  fromPhase: GxpmPhase;
  toPhase: GxpmPhase;
  timestamp: string;
}

export function rewindPhase(input: RewindInput): RewindResult {
  const toPhase = assertValidPhase(input.toPhase);
  if (!input.reason || !input.reason.trim()) {
    throw new Error("phase rewind requires --reason; explain why the rewind is needed");
  }

  const root = input.root ?? process.cwd();
  const paths = getIssuePaths(root, input.issueId);
  const state = readIssueState({ root, issueId: input.issueId });

  if (state.currentPhase === toPhase) {
    throw new Error(`Issue ${input.issueId} is already in phase ${toPhase}; nothing to rewind`);
  }

  const everEntered = state.phaseHistory?.some((h) => h.phase === toPhase);
  if (!everEntered) {
    throw new Error(
      `Cannot rewind ${input.issueId} to ${toPhase}: phaseHistory does not contain that phase. ` +
        `Only previously-entered phases may be rewound to.`,
    );
  }

  const now = new Date().toISOString();
  const fromPhase = state.currentPhase;

  const updated = {
    ...state,
    currentPhase: toPhase,
    updatedAt: now,
    phaseHistory: [
      ...state.phaseHistory,
      { phase: toPhase, enteredAt: now, fromPhase },
    ],
  };
  writeFileSync(paths.statePath, `${JSON.stringify(updated, null, 2)}\n`);

  const graph = JSON.parse(readFileSync(paths.graphPath, "utf8"));
  writeFileSync(
    paths.graphPath,
    `${JSON.stringify(
      {
        ...graph,
        currentPhase: toPhase,
        transitions: [
          ...(Array.isArray(graph.transitions) ? graph.transitions : []),
          { fromPhase, toPhase, timestamp: now, rewound: true },
        ],
      },
      null,
      2,
    )}\n`,
  );

  appendIssueEvent({
    issueDir: paths.issueDir,
    event: {
      schemaVersion: 1,
      type: "phase.rewound",
      issueId: input.issueId,
      timestamp: now,
      sessionId: resolveSessionId(),
      payload: {
        fromPhase,
        toPhase,
        reason: input.reason.trim(),
      },
    },
  });

  return { fromPhase, toPhase, timestamp: now };
}
