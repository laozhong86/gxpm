import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Agent Army Runtime —— 多角色并行审查的基础设施。
 *
 * 设计原则：
 * - 静态文档优先：Agent 定义以 .md 存在，运行时按需加载
 * - 薄封装：只负责发现、分派、合并，不侵入 Agent 内部逻辑
 * - Artifact 为契约：输入/输出全部通过 artifact JSON
 * - Fallback 机制：并行不支持时自动回退到串行
 */

export const ARMY_PHASES = ["self-review", "cleanup", "ship", "plan"] as const;
export type ArmyPhase = (typeof ARMY_PHASES)[number];

export const SEVERITY_LEVELS = ["blocking", "important", "suggestion"] as const;
export type SeverityLevel = (typeof SEVERITY_LEVELS)[number];

export interface AgentDefinition {
  name: string;
  phase: ArmyPhase;
  army: string;
  role: string;
  description: string;
  inputContract: string;
  outputFormat: string;
  hardGates: string[];
  filePath: string;
}

export interface AgentFinding {
  role: string;
  severity: SeverityLevel;
  location?: string;
  rationale: string;
  recommendation: string;
}

export interface ArmyReport {
  army: string;
  phase: ArmyPhase;
  issueId: string;
  generatedAt: string;
  findings: AgentFinding[];
  summary: string;
  status: "completed" | "partial" | "failed";
}

export interface AgentExecutionResult {
  agent: AgentDefinition;
  findings: AgentFinding[];
  error?: string;
}

const AGENTS_DIR = "agents";
const MD_EXTENSION = ".md";

function parseAgentMarkdown(content: string, filePath: string): AgentDefinition | null {
  const lines = content.split("\n");

  // Parse frontmatter (simple YAML-like)
  const frontmatter: Record<string, string> = {};
  let inFrontmatter = false;
  let frontmatterEnd = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === "---") {
      if (!inFrontmatter) {
        inFrontmatter = true;
        continue;
      } else {
        frontmatterEnd = i;
        break;
      }
    }
    if (inFrontmatter) {
      const colonIdx = line.indexOf(":");
      if (colonIdx > 0) {
        const key = line.slice(0, colonIdx).trim();
        const value = line.slice(colonIdx + 1).trim();
        frontmatter[key] = value;
      }
    }
  }

  const name = frontmatter.name ?? "";
  const description = frontmatter.description ?? "";
  if (!name) return null;

  // Parse sections
  const sections: Record<string, string[]> = {};
  let currentSection = "";

  for (let i = frontmatterEnd + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("## ")) {
      currentSection = line.slice(3).trim().toLowerCase();
      sections[currentSection] = [];
    } else if (currentSection) {
      sections[currentSection].push(line);
    }
  }

  // Extract hard gates from "红旗清单" or "hard-gate" section
  const hardGates: string[] = [];
  const gateSection =
    sections["红旗清单"] ??
    sections["hard-gate"] ??
    sections["hard gate"] ??
    sections["hard gates"] ??
    [];

  for (const line of gateSection) {
    const trimmed = line.trim();
    if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      hardGates.push(trimmed.slice(2).trim());
    }
  }

  // Extract input/output from sections
  const inputContract = sections["输入"]?.join("\n").trim() ??
    sections["input"]?.join("\n").trim() ??
    "";

  const outputFormat = sections["输出"]?.join("\n").trim() ??
    sections["output"]?.join("\n").trim() ??
    "";

  // Derive army and phase from file path: agents/<army>/<name>.md
  const pathParts = filePath.split("/");
  const army = pathParts.length >= 3 ? pathParts[pathParts.length - 2] : "";

  // Map army name to phase
  let phase: ArmyPhase = "self-review";
  if (army.includes("ship") || army.includes("audit")) {
    phase = "ship";
  } else if (army.includes("plan")) {
    phase = "plan";
  }

  return {
    name,
    phase,
    army,
    role: frontmatter.role ?? name,
    description,
    inputContract,
    outputFormat,
    hardGates,
    filePath,
  };
}

export class AgentRegistry {
  private agents: Map<string, AgentDefinition> = new Map();

  discover(root: string = process.cwd()): AgentDefinition[] {
    const agentsDir = join(root, AGENTS_DIR);
    if (!existsSync(agentsDir)) return [];

    const results: AgentDefinition[] = [];
    const entries = readdirSync(agentsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.endsWith("-army")) {
        const armyDir = join(agentsDir, entry.name);
        const files = readdirSync(armyDir);
        for (const file of files.sort()) {
          if (!file.endsWith(MD_EXTENSION)) continue;
          const filePath = join(armyDir, file);
          const content = readFileSync(filePath, "utf-8");
          const agent = parseAgentMarkdown(content, filePath);
          if (agent) {
            this.agents.set(agent.name, agent);
            results.push(agent);
          }
        }
      }
    }

    return results;
  }

  get(name: string): AgentDefinition | undefined {
    return this.agents.get(name);
  }

  listByPhase(phase: ArmyPhase): AgentDefinition[] {
    return Array.from(this.agents.values())
      .filter((a) => a.phase === phase)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  listByArmy(army: string): AgentDefinition[] {
    return Array.from(this.agents.values())
      .filter((a) => a.army === army)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  clear(): void {
    this.agents.clear();
  }
}

/**
 * Detect whether the current runtime supports true parallel subagent execution.
 * In Kimi CLI, subagent spawning may not be available.
 */
export function detectParallelSupport(): boolean {
  // For now, we check if we're in an environment that supports Agent tool
  // This can be enhanced with actual capability probing
  return typeof process.env.KIMI_CLI_VERSION !== "undefined" ||
    (typeof process.env.CLAUDE_CODE !== "undefined");
}

export interface ExecuteArmyInput {
  issueId: string;
  army: string;
  phase: ArmyPhase;
  agents: AgentDefinition[];
  context?: Record<string, unknown>;
}

/**
 * Execute a set of agents and produce a merged report.
 *
 * If parallel support is available, agents run concurrently.
 * Otherwise, they run sequentially with a warning.
 */
export async function executeArmy(input: ExecuteArmyInput): Promise<ArmyReport> {
  const parallel = detectParallelSupport();
  const results: AgentExecutionResult[] = [];

  if (!parallel && input.agents.length > 1) {
    console.warn(
      `parallel execution not supported, falling back to sequential for ${input.army}`,
    );
  }

  if (parallel) {
    // Parallel execution
    const promises = input.agents.map((agent) => executeAgent(agent, input));
    const settled = await Promise.allSettled(promises);
    for (let i = 0; i < settled.length; i++) {
      const result = settled[i];
      if (result.status === "fulfilled") {
        results.push(result.value);
      } else {
        results.push({
          agent: input.agents[i],
          findings: [],
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        });
      }
    }
  } else {
    // Sequential fallback
    for (const agent of input.agents) {
      try {
        const result = await executeAgent(agent, input);
        results.push(result);
      } catch (err) {
        results.push({
          agent,
          findings: [],
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  // Merge findings
  const allFindings: AgentFinding[] = [];
  for (const result of results) {
    allFindings.push(...result.findings);
  }

  // Sort by severity: blocking first, then important, then suggestion
  const severityOrder: Record<SeverityLevel, number> = {
    blocking: 0,
    important: 1,
    suggestion: 2,
  };
  allFindings.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  const hasErrors = results.some((r) => r.error);
  const allFailed = results.every((r) => r.error);

  const summaryParts: string[] = [
    `${input.army}: ${input.agents.length} role(s) executed`,
    `${allFindings.length} finding(s) total`,
    `${allFindings.filter((f) => f.severity === "blocking").length} blocking`,
    `${allFindings.filter((f) => f.severity === "important").length} important`,
    `${allFindings.filter((f) => f.severity === "suggestion").length} suggestion`,
  ];

  if (hasErrors) {
    summaryParts.push(`${results.filter((r) => r.error).length} role(s) failed`);
  }

  return {
    army: input.army,
    phase: input.phase,
    issueId: input.issueId,
    generatedAt: new Date().toISOString(),
    findings: allFindings,
    summary: summaryParts.join(", "),
    status: allFailed ? "failed" : hasErrors ? "partial" : "completed",
  };
}

/**
 * Execute a single agent. In a real implementation, this would spawn a subagent.
 * For now, we produce a placeholder that marks the agent as "awaiting execution".
 */
async function executeAgent(
  agent: AgentDefinition,
  input: ExecuteArmyInput,
): Promise<AgentExecutionResult> {
  // In the current architecture, actual agent execution happens via the host's
  // subagent mechanism. This function returns a structural result that the
  // caller can use to invoke subagents externally.
  return {
    agent,
    findings: [],
  };
}

/**
 * Check if an army report contains any blocking findings.
 */
export function hasBlockingFindings(report: ArmyReport): boolean {
  return report.findings.some((f) => f.severity === "blocking");
}

/**
 * Count findings by severity.
 */
export function countFindingsBySeverity(
  report: ArmyReport,
): Record<SeverityLevel, number> {
  const counts: Record<SeverityLevel, number> = {
    blocking: 0,
    important: 0,
    suggestion: 0,
  };
  for (const finding of report.findings) {
    counts[finding.severity]++;
  }
  return counts;
}

// Singleton registry for discoverability
let globalRegistry: AgentRegistry | null = null;

export function getGlobalAgentRegistry(): AgentRegistry {
  if (!globalRegistry) {
    globalRegistry = new AgentRegistry();
  }
  return globalRegistry;
}
