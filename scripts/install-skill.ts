import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { ALL_HOST_CONFIGS, getHostConfig } from "../hosts";
import { discoverTemplates } from "./discover-skills";
import { renderSkillContentForHost } from "./gen-skill-docs";
import { SkillParser, HostConverter, SkillWriter } from "../core/converters";
import type { HostConfig } from "../core/contracts/host";

interface InstallSkillOptions {
  /** @deprecated use `hosts` instead */
  hostName?: string; // "codex" | "claude" | "all"
  /** Explicit list of host names to install to. Overrides `hostName`. */
  hosts?: string[];
  root?: string; // gxpm repo root (default: cwd)
  home?: string; // override for testing (default: homedir())
}

// Default root is the gxpm repo itself (the parent of scripts/), not cwd —
// install-skill must read templates from gxpm regardless of where it's invoked.
const DEFAULT_GXPM_ROOT = resolve(import.meta.dir, "..");

function resolveSkillInstallPath(skillName: string, host: HostConfig, home: string): string {
  // For gxpm main skill, preserve backward-compatible path using host.globalRoot
  if (skillName === "gxpm") {
    return join(home, host.globalRoot, "SKILL.md");
  }
  // For other skills, install into host-specific skill directory
  if (host.name === "codex") {
    return join(home, ".codex", "skills", skillName, "SKILL.md");
  }
  if (host.name === "claude") {
    return join(home, ".claude", "skills", skillName, "SKILL.md");
  }
  // Fallback to host.globalRoot parent + skill name
  return join(home, dirname(host.globalRoot), skillName, "SKILL.md");
}

function renderOrReadSkill(root: string, host: HostConfig, template: ReturnType<typeof discoverTemplates>[number]): string {
  if (template.tmpl.endsWith(".tmpl")) {
    return renderSkillContentForHost(root, host, template.tmpl, template.references);
  }

  // Static file: use the new AST pipeline for multi-platform conversion
  const source = readFileSync(join(root, template.tmpl), "utf8");
  const parser = new SkillParser();
  const converter = new HostConverter();
  const writer = new SkillWriter();
  const doc = parser.parse(source);
  const converted = converter.convert(doc, { hostName: host.name });
  return writer.write(converted);
}

export function installSkill(options: InstallSkillOptions = {}): string[] {
  const root = options.root ?? DEFAULT_GXPM_ROOT;
  const home = options.home ?? homedir();
  const targets = resolveTargets(options.hostName, options.hosts);

  const installed: string[] = [];

  for (const template of discoverTemplates(root)) {
    for (const host of targets) {
      const content = renderOrReadSkill(root, host, template);
      // For .tmpl files, frontmatter is not yet filtered; apply host-specific filtering.
      // For static files, the new pipeline already filtered frontmatter.
      const transformed = template.tmpl.endsWith(".tmpl") ? applyFrontmatter(content, host) : content;
      const installPath = resolveSkillInstallPath(template.name, host, home);
      mkdirSync(dirname(installPath), { recursive: true });
      writeFileSync(installPath, transformed);
      installed.push(installPath);

      // Install references
      if (template.references) {
        const skillInstallDir = dirname(installPath);
        const refsInstallDir = join(skillInstallDir, "references");
        for (const refPath of template.references) {
          const refContent = readFileSync(join(root, refPath), "utf8");
          const refName = refPath.replace(/^.*\//, "");
          const refInstallPath = join(refsInstallDir, refName);
          mkdirSync(refsInstallDir, { recursive: true });
          writeFileSync(refInstallPath, refContent);
          installed.push(refInstallPath);
        }
      }

      // Install scripts
      if (template.scripts) {
        const skillInstallDir = dirname(installPath);
        const scriptsInstallDir = join(skillInstallDir, "scripts");
        for (const scriptPath of template.scripts) {
          const scriptContent = readFileSync(join(root, scriptPath), "utf8");
          const scriptName = scriptPath.replace(/^.*\//, "");
          const scriptInstallPath = join(scriptsInstallDir, scriptName);
          mkdirSync(scriptsInstallDir, { recursive: true });
          writeFileSync(scriptInstallPath, scriptContent);
          installed.push(scriptInstallPath);
        }
      }
    }
  }

  return installed;
}

function resolveTargets(name: string | undefined, hosts: string[] | undefined): readonly HostConfig[] {
  if (hosts && hosts.length > 0) {
    return hosts.map((n) => getHostConfig(n));
  }
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
  hosts?: string[];
  root?: string;
  home?: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const options: ParsedArgs = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--host") {
      options.hostName = argv[++index];
    } else if (arg === "--hosts") {
      const raw = argv[++index];
      options.hosts = raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : [];
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
      hosts: args.hosts,
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
