import { rewindPhase } from "../../core/phase-rewind";

function parseRewindArgs(argv: string[]): {
  issueId: string;
  toPhase: string;
  reason: string;
} {
  // Expected: gxpm phase rewind <issue-id> --to <phase> --reason "<text>"
  // argv slice already starts after "phase rewind"
  const issueId = argv[0];
  if (!issueId) {
    throw new Error(
      'usage: gxpm phase rewind <issue-id> --to <phase> --reason "<text>"',
    );
  }

  let toPhase: string | undefined;
  let reason: string | undefined;

  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--to") {
      toPhase = argv[++i];
      continue;
    }
    if (arg.startsWith("--to=")) {
      toPhase = arg.slice("--to=".length);
      continue;
    }
    if (arg === "--reason") {
      reason = argv[++i];
      continue;
    }
    if (arg.startsWith("--reason=")) {
      reason = arg.slice("--reason=".length);
      continue;
    }
  }

  if (!toPhase) {
    throw new Error("phase rewind requires --to <phase>");
  }
  if (!reason || !reason.trim()) {
    throw new Error("phase rewind requires --reason \"<text>\"");
  }

  return { issueId, toPhase, reason };
}

export function runPhaseCommand(argv: string[], subcommand: string | undefined) {
  if (subcommand !== "rewind") {
    throw new Error(`unknown phase subcommand: ${subcommand ?? "<none>"}; expected rewind`);
  }
  // Strip "phase rewind" prefix; remaining argv has [<issue-id>, --to, <phase>, --reason, <text>]
  const args = argv.slice(2);
  const { issueId, toPhase, reason } = parseRewindArgs(args);
  const result = rewindPhase({ issueId, toPhase, reason });
  console.log(
    `rewound ${issueId}: ${result.fromPhase} -> ${result.toPhase} (${result.timestamp})`,
  );
}
