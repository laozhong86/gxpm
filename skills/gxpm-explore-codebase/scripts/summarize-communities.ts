#!/usr/bin/env bun
/**
 * Summarize GitNexus community data into a compact markdown table.
 * Reads JSON from stdin (e.g., list_communities output) and writes markdown to stdout.
 *
 * Usage:
 *   cat communities.json | bun run summarize-communities.ts
 */

interface Community {
  name?: string;
  size?: number;
  cohesion?: number;
  dominantLanguage?: string;
}

const chunks: Buffer[] = [];
for await (const chunk of Bun.stdin.stream()) {
  chunks.push(Buffer.from(chunk));
}

const json = Buffer.concat(chunks).toString("utf8").trim();

if (!json) {
  console.error("No input received. Pipe JSON to stdin.");
  process.exit(1);
}

try {
  const data = JSON.parse(json) as { communities?: Community[] };
  const communities = data.communities ?? [];

  if (communities.length === 0) {
    console.log("No communities found.");
    process.exit(0);
  }

  console.log("| Community | Size | Cohesion | Language |");
  console.log("|-----------|------|----------|----------|");

  for (const community of communities) {
    const name = community.name ?? "unnamed";
    const size = community.size ?? 0;
    const cohesion = community.cohesion != null ? community.cohesion.toFixed(2) : "n/a";
    const language = community.dominantLanguage ?? "mixed";
    console.log(`| ${name} | ${size} | ${cohesion} | ${language} |`);
  }
} catch (error) {
  console.error("Failed to parse JSON:", error);
  process.exit(1);
}
