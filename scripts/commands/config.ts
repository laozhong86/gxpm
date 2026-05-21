import { existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { getConfigValue, getResolvedConfigValue, listConfigEntries, resolveWorktreePolicy, setConfigValue } from "../../core/config";
import { readSyncState, resolveSyncProvider } from "../../core/issue-sync";

export function runWorktreePolicyCommand(argv: string[], subcommand: string | undefined) {
  if (subcommand === "policy") {
    const policy = resolveWorktreePolicy();
    if (argv.includes("--json")) {
      console.log(JSON.stringify(policy, null, 2));
      return;
    }
    console.log(`worktree.enforcement: ${policy.enforcement}`);
    console.log(`worktree.default:     ${policy.default}`);
    console.log(`source:               ${policy.source}`);
    return;
  }
  if (subcommand === "prune") {
    runWorktreePrune(argv);
    return;
  }
  throw new Error(`Unknown command: ${["worktree", subcommand].filter(Boolean).join(" ")}`);
}

// GXPM-182: prune orphan worktree dirs under .gxpm/worktrees/ that are no
// longer registered with git (left behind by partial cleanup-land before
// GXPM-192). Default is dry-run; --execute deletes. Skips dirs younger than
// --age-days N and dirs whose issue is in a non-terminal phase.
function runWorktreePrune(argv: string[]): void {
  const execute = argv.includes("--execute");
  let ageDays: number | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--age-days") {
      const v = argv[i + 1];
      const parsed = Number.parseInt(v ?? "", 10);
      if (Number.isNaN(parsed)) throw new Error("--age-days expects an integer");
      ageDays = parsed;
    }
  }

  const root = process.cwd();
  const worktreesDir = join(root, ".gxpm", "worktrees");
  if (!existsSync(worktreesDir)) {
    console.log("no .gxpm/worktrees/ directory");
    return;
  }

  // Collect registered worktree paths via git porcelain output.
  const registered = new Set<string>();
  const gitListResult = Bun.spawnSync({
    cmd: ["git", "worktree", "list", "--porcelain"],
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (gitListResult.exitCode === 0) {
    for (const line of gitListResult.stdout.toString().split("\n")) {
      if (line.startsWith("worktree ")) registered.add(line.slice("worktree ".length).trim());
    }
  }

  type Candidate = {
    path: string;
    name: string;
    ageDays: number;
    issueId?: string;
    issuePhase?: string;
  };
  const candidates: Candidate[] = [];
  const scannedEntries = readdirSync(worktreesDir, { withFileTypes: true });
  for (const entry of scannedEntries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const fullPath = join(worktreesDir, entry.name);
    if (registered.has(fullPath)) continue;

    let mtimeMs = 0;
    try {
      mtimeMs = statSync(fullPath).mtimeMs;
    } catch {
      continue;
    }
    const dirAgeDays = (Date.now() - mtimeMs) / (1000 * 60 * 60 * 24);
    if (ageDays !== undefined && dirAgeDays < ageDays) continue;

    const idMatch = entry.name.match(/^gxpm-(.+)$/);
    let issueId: string | undefined;
    let issuePhase: string | undefined;
    if (idMatch) {
      issueId = idMatch[1];
      const statePath = join(root, ".gxpm", "issues", issueId, "state.json");
      if (existsSync(statePath)) {
        try {
          issuePhase = (JSON.parse(readFileSync(statePath, "utf8")) as { currentPhase?: string })
            .currentPhase;
        } catch {
          // best-effort; treat as missing phase
        }
      }
    }

    candidates.push({
      path: fullPath,
      name: entry.name,
      ageDays: Math.floor(dirAgeDays),
      issueId,
      issuePhase,
    });
  }

  // Safe to prune: no state OR phase is terminal `land`.
  const safe = candidates.filter((c) => !c.issuePhase || c.issuePhase === "land");
  const blocked = candidates.filter((c) => c.issuePhase && c.issuePhase !== "land");

  console.log(
    `scanned: ${scannedEntries.length} dir(s); registered with git: ${registered.size}; orphans: ${candidates.length}`,
  );
  if (blocked.length > 0) {
    console.log("blocked from prune (issue still active):");
    for (const c of blocked) {
      console.log(`  ${c.name}  phase=${c.issuePhase}  ${c.ageDays}d old`);
    }
  }
  if (safe.length === 0) {
    console.log("no orphans safe to prune");
    return;
  }

  if (!execute) {
    console.log("DRY-RUN — would prune:");
    for (const c of safe) {
      const detail = c.issueId ? `issue ${c.issueId}${c.issuePhase ? ` phase=${c.issuePhase}` : ""}` : "no issue mapping";
      console.log(`  ${c.name}  ${c.ageDays}d old  ${detail}`);
    }
    console.log("\nRe-run with --execute to actually delete.");
    return;
  }

  for (const c of safe) {
    try {
      rmSync(c.path, { recursive: true, force: true });
      console.log(`pruned ${c.name}`);
    } catch (err) {
      console.warn(
        `failed to prune ${c.name}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
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
