import type { ManagedBlock, ParseOptions, Parser, SkillDocument, SkillFrontmatter, SkillSection } from "../contracts/converter";

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/;
const MANAGED_BEGIN_RE = /<!--\s*BEGIN\s+MANAGED:(\S+)\s*-->/gi;

function parseFrontmatter(source: string): { frontmatter: SkillFrontmatter; bodyStart: number } {
  const match = source.match(FRONTMATTER_RE);
  if (!match) {
    return { frontmatter: {}, bodyStart: 0 };
  }

  const fm: SkillFrontmatter = {};
  const lines = match[1].split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const colonIndex = trimmed.indexOf(":");
    if (colonIndex < 0) continue;
    const key = trimmed.slice(0, colonIndex).trim();
    const rawValue = trimmed.slice(colonIndex + 1).trim();
    if (rawValue === "true") {
      fm[key] = true;
    } else if (rawValue === "false") {
      fm[key] = false;
    } else if (/^-?\d+$/.test(rawValue)) {
      fm[key] = Number(rawValue);
    } else {
      fm[key] = rawValue;
    }
  }

  return { frontmatter: fm, bodyStart: match[0].length };
}

function splitSections(body: string): SkillSection[] {
  const sections: SkillSection[] = [];
  const lines = body.split("\n");
  let buffer: string[] = [];
  let inCodeBlock = false;
  let codeLang = "";

  function flush() {
    if (buffer.length === 0) return;
    const content = buffer.join("\n");
    if (content.trim().length === 0) {
      buffer = [];
      return;
    }

    const firstLine = buffer[0];
    if (firstLine.startsWith("#")) {
      const level = firstLine.match(/^#+/)?.[0].length ?? 1;
      sections.push({ type: "heading", content, level });
    } else if (firstLine.startsWith("```")) {
      sections.push({ type: "code", content, lang: codeLang });
    } else if (firstLine.startsWith(">")) {
      sections.push({ type: "blockquote", content });
    } else if (/^\s*[-*+]|^\s*\d+\./.test(firstLine)) {
      sections.push({ type: "list", content });
    } else if (firstLine.startsWith("<") || firstLine.startsWith("<!--")) {
      sections.push({ type: "html", content });
    } else {
      sections.push({ type: "paragraph", content });
    }
    buffer = [];
  }

  for (const line of lines) {
    if (line.startsWith("```")) {
      if (inCodeBlock) {
        buffer.push(line);
        flush();
        inCodeBlock = false;
        codeLang = "";
        continue;
      }
      flush();
      inCodeBlock = true;
      codeLang = line.slice(3).trim();
      buffer.push(line);
      continue;
    }

    if (inCodeBlock) {
      buffer.push(line);
      continue;
    }

    if (line.startsWith("#")) {
      flush();
      buffer.push(line);
      continue;
    }

    if (line.trim() === "") {
      flush();
      continue;
    }

    buffer.push(line);
  }

  flush();
  return sections;
}

function extractManagedBlocks(body: string): { blocks: ManagedBlock[]; cleanedBody: string } {
  const blocks: ManagedBlock[] = [];
  let cleaned = body;

  let offset = 0;
  while (true) {
    const beginMatch = MANAGED_BEGIN_RE.exec(body);
    if (!beginMatch) break;

    const blockId = beginMatch[1];
    const startIndex = beginMatch.index;
    const endRe = new RegExp(`<!--\\s*END\\s+MANAGED:${blockId}\\s*-->`, "i");
    const afterBegin = body.slice(startIndex + beginMatch[0].length);
    const endMatch = endRe.exec(afterBegin);
    if (!endMatch) {
      throw new Error(`Unclosed managed block: ${blockId} at index ${startIndex}`);
    }

    const contentStart = startIndex + beginMatch[0].length;
    const contentEnd = contentStart + endMatch.index;
    const content = body.slice(contentStart, contentEnd);
    blocks.push({ id: blockId, content });

    const blockEnd = contentEnd + endMatch[0].length;
    cleaned = cleaned.slice(0, startIndex - offset) + cleaned.slice(blockEnd - offset);
    offset += blockEnd - startIndex;
  }

  return { blocks, cleanedBody: cleaned };
}

export class SkillParser implements Parser {
  parse(source: string, options?: ParseOptions): SkillDocument {
    const { frontmatter, bodyStart } = parseFrontmatter(source);
    let body = source.slice(bodyStart);

    let managedBlocks: ManagedBlock[] = [];
    if (options?.extractManagedBlocks) {
      const extracted = extractManagedBlocks(body);
      managedBlocks = extracted.blocks;
      body = extracted.cleanedBody;
    }

    const sections = splitSections(body);

    return {
      frontmatter,
      body: sections,
      managedBlocks,
      raw: source,
    };
  }
}
