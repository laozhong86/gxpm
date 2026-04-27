const SUPPORTED_PREFIXES = ["gxpm", "git", "bun", "npm", "cmux", "agent-browser"] as const;

type SupportedPrefix = (typeof SUPPORTED_PREFIXES)[number];

export interface CommandProbeFinding {
  command: string;
  reason: string;
}

export function probeArtifactPayloadCommands(payload: unknown): CommandProbeFinding[] {
  const text = collectText(payload);
  const commands = extractCandidateCommands(text);
  return commands.flatMap(validateCandidateCommand);
}

function collectText(payload: unknown): string {
  if (typeof payload === "string") return payload;
  if (Array.isArray(payload)) return payload.map(collectText).join("\n");
  if (payload && typeof payload === "object") {
    return Object.values(payload as Record<string, unknown>).map(collectText).join("\n");
  }
  return "";
}

function extractCandidateCommands(text: string): string[] {
  const commands = new Set<string>();
  const fenced = [...text.matchAll(/```[\s\S]*?```/g)].map((match) =>
    match[0].replace(/^```[a-zA-Z0-9_-]*\n?/, "").replace(/```$/, ""),
  );
  const inline = [...text.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
  for (const block of [...fenced, ...inline]) {
    for (const line of block.split("\n")) {
      const trimmed = line.trim();
      if (SUPPORTED_PREFIXES.some((prefix) => trimmed === prefix || trimmed.startsWith(`${prefix} `))) {
        commands.add(trimmed);
      }
    }
  }
  return [...commands];
}

function validateCandidateCommand(command: string): CommandProbeFinding[] {
  const [prefix, subcommand] = command.split(/\s+/, 3);
  if (!isSupportedPrefix(prefix)) {
    return [];
  }
  if (prefix === "gxpm") {
    const allowed = new Set([
      "issue",
      "artifact",
      "triage",
      "plan",
      "dispatch",
      "implement",
      "local-verify",
      "ac-check",
      "self-review",
      "ship",
      "pr-check",
      "verify",
      "qa",
      "land",
      "doctor",
      "wiki",
      "qoder",
      "gate",
      "config",
      "worktree",
      "version",
      "check",
    ]);
    return allowed.has(subcommand ?? "")
      ? []
      : [{ command, reason: `unknown gxpm subcommand: ${subcommand ?? "<missing>"}` }];
  }
  return subcommand
    ? []
    : [{ command, reason: `missing subcommand after ${prefix}` }];
}

function isSupportedPrefix(value: string): value is SupportedPrefix {
  return SUPPORTED_PREFIXES.includes(value as SupportedPrefix);
}
