/**
 * `gxpm hook <event> --host <host>`
 *
 * Unified hook entry point called by all host-specific hook configurations.
 * Reads JSON from stdin, dispatches to the hook engine, and prints host-formatted output.
 */

import { processHook, formatHookOutput, isValidHookHost, type HookInput } from "../../core/hook-engine";

export async function runHookCommand(argv: string[]): Promise<void> {
  // argv: ["hook", "SessionStart", "--host", "codex", ...]
  const eventName = argv[1];
  if (!eventName) {
    console.error("Usage: gxpm hook <event> --host <claude|codex|cursor|kimi>");
    process.exit(1);
  }

  let host: string | undefined;
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === "--host" && i + 1 < argv.length) {
      host = argv[i + 1];
      break;
    }
  }

  if (!host || !isValidHookHost(host)) {
    console.error("Usage: gxpm hook <event> --host <claude|codex|cursor|kimi>");
    process.exit(1);
  }

  let input: HookInput;
  try {
    const raw = await readStdin();
    input = raw ? JSON.parse(raw) : ({} as HookInput);
  } catch {
    // fail-open: if stdin is not valid JSON, allow the action to proceed
    process.exit(0);
  }

  const result = await processHook(host, eventName, input);

  const output = formatHookOutput(host, eventName, result);
  if (output) {
    console.log(output);
  }

  process.exit(result.exitCode);
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      resolve("");
      return;
    }
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => {
      resolve(data);
    });
    process.stdin.resume();
  });
}
