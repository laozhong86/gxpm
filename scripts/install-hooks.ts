import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

interface HookSpec {
  gxpmFile: string;
  topLevelFile: string;
  argsForwarding: string;
}

const HOOK_SPECS: HookSpec[] = [
  { gxpmFile: "gxpm-pre-commit", topLevelFile: "pre-commit", argsForwarding: "" },
  { gxpmFile: "gxpm-commit-msg", topLevelFile: "commit-msg", argsForwarding: ' "$1"' },
  { gxpmFile: "gxpm-pre-push", topLevelFile: "pre-push", argsForwarding: ' "$@"' },
  { gxpmFile: "gxpm-post-merge", topLevelFile: "post-merge", argsForwarding: ' "$@"' },
  { gxpmFile: "gxpm-post-checkout", topLevelFile: "post-checkout", argsForwarding: ' "$@"' },
];

function dispatcherScript(gxpmFile: string, argsForwarding: string): string {
  return `#!/bin/bash
# gxpm dispatcher (installed by gxpm-init --install-hooks)
# Calls the gxpm-specific hook if present; harmless otherwise.
set -e
HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -x "$HOOK_DIR/${gxpmFile}" ]; then
  "$HOOK_DIR/${gxpmFile}"${argsForwarding}
fi
`;
}

interface InstallOptions {
  target: string;
}

function parseArgs(argv: string[]): InstallOptions {
  const dashTarget = argv.indexOf("--target");
  const target = dashTarget >= 0 ? argv[dashTarget + 1] : process.cwd();
  return { target: resolve(target) };
}

function isGitRepo(dir: string): boolean {
  const gitDir = join(dir, ".git");
  if (!existsSync(gitDir)) return false;
  try {
    return statSync(gitDir).isDirectory();
  } catch {
    return false;
  }
}

function main(argv: string[]) {
  const { target } = parseArgs(argv);

  if (!isGitRepo(target)) {
    console.error(`Not a git repository: ${target}`);
    process.exit(1);
  }

  const templatesDir = resolve(import.meta.dir, "..", "templates", "hooks");
  const hooksDir = join(target, ".githooks");
  mkdirSync(hooksDir, { recursive: true });

  const skipped: string[] = [];

  for (const spec of HOOK_SPECS) {
    const src = join(templatesDir, spec.gxpmFile);
    const dst = join(hooksDir, spec.gxpmFile);
    copyFileSync(src, dst);
    execSync(`chmod +x "${dst}"`);
    console.log(`installed: .githooks/${spec.gxpmFile}`);

    const topLevelPath = join(hooksDir, spec.topLevelFile);
    if (!existsSync(topLevelPath)) {
      writeFileSync(topLevelPath, dispatcherScript(spec.gxpmFile, spec.argsForwarding));
      execSync(`chmod +x "${topLevelPath}"`);
      console.log(`created dispatcher: .githooks/${spec.topLevelFile}`);
    } else {
      skipped.push(spec.topLevelFile);
    }
  }

  const absoluteHooksPath = join(resolve(target), ".githooks");
  let currentHooksPath = "";
  try {
    currentHooksPath = execSync("git config core.hooksPath", { cwd: target }).toString().trim();
  } catch {
    // unset
  }
  if (currentHooksPath !== absoluteHooksPath) {
    execSync(`git config core.hooksPath "${absoluteHooksPath}"`, { cwd: target });
    console.log(`set git config core.hooksPath = ${absoluteHooksPath}`);
  } else {
    console.log(`core.hooksPath already = ${absoluteHooksPath}`);
  }

  if (skipped.length > 0) {
    console.log("");
    console.log("Existing top-level hooks were NOT overwritten:");
    for (const name of skipped) {
      console.log(`  .githooks/${name}`);
    }
    console.log("To wire gxpm into them, append:");
    console.log('  [ -x .githooks/gxpm-<hook-name> ] && .githooks/gxpm-<hook-name> "$@"');
  }
}

main(Bun.argv.slice(2));
