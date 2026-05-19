/**
 * Install Kimi CLI hooks that call the unified `gxpm hook` entry point.
 *
 * Appends/updates a `[[hooks]]` block in `~/.kimi/config.toml`.
 * Kimi hooks are user-scoped only (no repo-level hooks.json equivalent).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

interface InstallKimiHooksOptions {
  home?: string;
}

interface InstallResult {
  configTomlPath: string;
  rootDir: string;
}

const GXPM_HOOKS_START = "# gxpm hooks (managed by gxpm init) — do not edit manually";
const GXPM_HOOKS_END = "# end gxpm hooks";

const HOOKS_TOML = `[[hooks]]
event = "SessionStart"
command = "gxpm hook SessionStart --host kimi"
matcher = "startup|clear|compact"
timeout = 30

[[hooks]]
event = "UserPromptSubmit"
command = "gxpm hook UserPromptSubmit --host kimi"
matcher = ""
timeout = 30

[[hooks]]
event = "PreToolUse"
command = "gxpm hook PreToolUse --host kimi"
matcher = "edit_file|write_file"
timeout = 10`;

export function installKimiHooks(options: InstallKimiHooksOptions = {}): InstallResult {
  const home = options.home ?? homedir();
  const rootDir = join(home, ".kimi");
  mkdirSync(rootDir, { recursive: true });

  const configTomlPath = join(rootDir, "config.toml");

  let content = existsSync(configTomlPath) ? readFileSync(configTomlPath, "utf8") : "";
  content = replaceGxpmBlock(content, HOOKS_TOML);
  writeFileSync(configTomlPath, content);

  return { configTomlPath, rootDir };
}

function replaceGxpmBlock(content: string, block: string): string {
  const startIdx = content.indexOf(GXPM_HOOKS_START);
  const endIdx = content.indexOf(GXPM_HOOKS_END);

  if (startIdx >= 0 && endIdx >= 0 && endIdx > startIdx) {
    // Replace existing block
    const before = content.slice(0, startIdx);
    const after = content.slice(endIdx + GXPM_HOOKS_END.length);
    return `${before.trimEnd()}\n\n${GXPM_HOOKS_START}\n${block}\n${GXPM_HOOKS_END}\n${after.trimStart()}`;
  }

  // Append new block
  const trimmed = content.trimEnd();
  const separator = trimmed.length > 0 ? "\n\n" : "";
  return `${trimmed}${separator}${GXPM_HOOKS_START}\n${block}\n${GXPM_HOOKS_END}\n`;
}

function parseArgs(argv: string[]): InstallKimiHooksOptions {
  const opts: InstallKimiHooksOptions = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--home") opts.home = argv[++i];
    else throw new Error(`Unknown argument: ${a}`);
  }
  return opts;
}

if (import.meta.main) {
  try {
    const result = installKimiHooks(parseArgs(Bun.argv.slice(2)));
    console.log(`wrote: ${result.configTomlPath}`);
    console.log("Restart Kimi CLI to activate hooks.");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
