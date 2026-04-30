import { getResolvedConfigValue, listConfigEntries, resolveWorktreePolicy, setConfigValue } from "../../core/config";

export function runWorktreePolicyCommand(argv: string[], subcommand: string | undefined) {
  if (subcommand !== "policy") {
    throw new Error(`Unknown command: ${["worktree", subcommand].filter(Boolean).join(" ")}`);
  }
  const policy = resolveWorktreePolicy();
  if (argv.includes("--json")) {
    console.log(JSON.stringify(policy, null, 2));
    return;
  }
  console.log(`worktree.enforcement: ${policy.enforcement}`);
  console.log(`worktree.default:     ${policy.default}`);
  console.log(`source:               ${policy.source}`);
}

export function runConfigCommand(
  argv: string[],
  subcommand: string | undefined,
  thirdArg: string | undefined,
  fourthArg: string | undefined,
) {
  if (subcommand === "get") {
    if (!thirdArg) throw new Error("Usage: gxpm config get <key>");
    const result = getResolvedConfigValue({ key: thirdArg });
    if (argv.includes("--raw")) {
      console.log(String(result.value));
    } else {
      console.log(`${thirdArg}: ${JSON.stringify(result.value)}`);
      console.log(`source:  ${result.source}`);
    }
    return;
  }

  if (subcommand === "set") {
    if (!thirdArg || fourthArg === undefined) {
      throw new Error("Usage: gxpm config set <key> <value> [--global]");
    }
    const scope = argv.includes("--global") ? "global" : "repo";
    const path = setConfigValue({
      scope,
      key: thirdArg,
      value: parseConfigValueLiteral(fourthArg),
    });
    console.log(`set ${thirdArg} = ${fourthArg} (${scope}); wrote ${path}`);
    return;
  }

  if (subcommand === "list" || !subcommand) {
    if (argv.includes("--json")) {
      console.log(JSON.stringify(listConfigEntries(), null, 2));
      return;
    }
    for (const entry of listConfigEntries()) {
      console.log(`${entry.key}: ${JSON.stringify(entry.value)} (${entry.source})`);
    }
    return;
  }

  throw new Error(`Unknown config subcommand: ${subcommand}`);
}

function parseConfigValueLiteral(raw: string): unknown {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (/^-?\d+$/.test(raw)) return Number(raw);
  return raw;
}
