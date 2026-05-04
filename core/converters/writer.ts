import type { ManagedBlock, SkillDocument, SkillFrontmatter, SkillSection, TargetWriter, WriteOptions } from "../contracts/converter";
import { mergeManagedBlocks } from "./managed-artifact";

function serializeFrontmatter(fm: SkillFrontmatter): string {
  const entries = Object.entries(fm).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return "";
  const lines = entries.map(([k, v]) => {
    if (typeof v === "boolean") return `${k}: ${v}`;
    if (typeof v === "number") return `${k}: ${v}`;
    return `${k}: ${v}`;
  });
  return `---\n${lines.join("\n")}\n---\n`;
}

function serializeSection(section: SkillSection): string {
  return section.content;
}

function serializeBody(sections: SkillSection[]): string {
  return sections.map(serializeSection).join("\n\n");
}

function wrapManagedBlock(block: ManagedBlock): string {
  return `<!-- BEGIN MANAGED:${block.id} -->\n${block.content}\n<!-- END MANAGED:${block.id} -->`;
}

export class SkillWriter implements TargetWriter {
  write(doc: SkillDocument, options?: WriteOptions): string {
    // 1. Build generated content
    const fm = serializeFrontmatter(doc.frontmatter);
    const body = serializeBody(doc.body);

    let managedBody = body;
    if (doc.managedBlocks.length > 0) {
      const blocksText = doc.managedBlocks.map(wrapManagedBlock).join("\n\n");
      managedBody = `${body}\n\n${blocksText}`;
    }

    let generated = fm ? `${fm}\n${managedBody}` : managedBody;

    if (options?.generatedMark) {
      const fmMatch = generated.match(/^---\n[\s\S]*?\n---\n?/);
      if (fmMatch) {
        const head = fmMatch[0].trimEnd();
        const rest = generated.slice(fmMatch[0].length).replace(/^\n+/, "");
        generated = `${head}\n${options.generatedMark}\n\n${rest}`;
      } else {
        generated = `${options.generatedMark}\n\n${generated}`;
      }
    }

    // 2. If existing content provided, merge managed blocks
    if (options?.existingContent) {
      generated = mergeManagedBlocks(options.existingContent, generated);
    }

    return generated;
  }
}

export { serializeFrontmatter, serializeBody, wrapManagedBlock };
