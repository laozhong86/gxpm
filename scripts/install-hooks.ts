import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const HOOK_FILES = [
  "gxpm-pre-commit",
  "gxpm-commit-msg",
  "gxpm-pre-push",
  "gxpm-post-merge",
];

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

  for (const hook of HOOK_FILES) {
    const src = join(templatesDir, hook);
    const dst = join(hooksDir, hook);
    copyFileSync(src, dst);
    execSync(`chmod +x "${dst}"`);
    console.log(`installed: .githooks/${hook}`);
  }

  let currentHooksPath = "";
  try {
    currentHooksPath = execSync("git config core.hooksPath", { cwd: target }).toString().trim();
  } catch {
    // unset
  }
  if (currentHooksPath !== ".githooks") {
    execSync("git config core.hooksPath .githooks", { cwd: target });
    console.log("set git config core.hooksPath = .githooks");
  } else {
    console.log("core.hooksPath already = .githooks");
  }

  console.log("");
  console.log("Integration note:");
  console.log("  - Existing .githooks/pre-commit (if any) was NOT modified.");
  console.log("  - To activate gxpm gate, add this line to your existing pre-commit:");
  console.log("      [ -x .githooks/gxpm-pre-commit ] && .githooks/gxpm-pre-commit");
  console.log("  - Same pattern for commit-msg, pre-push, post-merge.");
}

main(Bun.argv.slice(2));
