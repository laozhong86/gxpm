import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { ALL_HOST_CONFIGS, getHostConfig } from "../hosts";
import { renderSkillContentForHost } from "./gen-skill-docs";
import type { HostConfig } from "./host-config";

interface InstallSkillOptions {
  hostName?: string; // "codex" | "claude" | "all"
  root?: string; // gxpm repo root (default: cwd)
  home?: string; // override for testing (default: homedir())
}

const SKILL_TEMPLATE_RELATIVE = "skills/gxpm/SKILL.md.tmpl";

export function installSkill(options: InstallSkillOptions = {}): string[] {
  const root = options.root ?? process.cwd();
  const home = options.home ?? homedir();
  const targets = resolveTargets(options.hostName);

  const installed: string[] = [];

  for (const host of targets) {
    const content = renderSkillContentForHost(root, host, SKILL_TEMPLATE_RELATIVE);
    const transformed = applyFrontmatter(content, host);

    const installPath = join(home, host.globalRoot, "SKILL.md");
    mkdirSync(dirname(installPath), { recursive: true });
    writeFileSync(installPath, transformed);
    installed.push(installPath);
  }

  return installed;
}

function resolveTargets(name: string | undefined): readonly HostConfig[] {
  if (!name || name === "all") {
    return ALL_HOST_CONFIGS;
  }
  return [getHostConfig(name)];
}

function applyFrontmatter(content: string, host: HostConfig): string {
  if (host.frontmatter.mode === "preserve") {
    return content;
  }

  const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) {
    return content;
  }

  const body = content.slice(match[0].length);
  const allowed = new Set(host.frontmatter.keys);
  const filteredFrontmatter = match[1]
    .split("\n")
    .filter((line) => {
      if (!line.trim() || line.startsWith("#")) return true;
      const colonIndex = line.indexOf(":");
      if (colonIndex < 0) return true;
      const key = line.slice(0, colonIndex).trim();
      return allowed.has(key);
    })
    .join("\n");

  return `---\n${filteredFrontmatter}\n---\n${body}`;
}

interface ParsedArgs {
  hostName?: string;
  root?: string;
  home?: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const options: ParsedArgs = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--host") {
      options.hostName = argv[++index];
    } else if (arg === "--root") {
      options.root = argv[++index];
    } else if (arg === "--home") {
      options.home = argv[++index];
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

if (import.meta.main) {
  try {
    const args = parseArgs(Bun.argv.slice(2));
    const installed = installSkill({
      hostName: args.hostName,
      root: args.root ? resolve(args.root) : undefined,
      home: args.home ? resolve(args.home) : undefined,
    });
    for (const path of installed) {
      console.log(`installed: ${path}`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
