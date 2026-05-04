#!/usr/bin/env bun
/**
 * Summarize code-review-graph community data into a compact markdown table.
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

const input = Buffer.alloc ? Buffer.alloc(0) : new Uint8Array();
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
  for (const c of communities) {
    const name = c.name ?? "unnamed";
    const size = c.size ?? 0;
    const cohesion = c.cohesion != null ? c.cohesion.toFixed(2) : "n/a";
    const lang = c.dominantLanguage ?? "mixed";
    console.log(`| ${name} | ${size} | ${cohesion} | ${lang} |`);
  }
} catch (err) {
  console.error("Failed to parse JSON:", err);
  process.exit(1);
}
