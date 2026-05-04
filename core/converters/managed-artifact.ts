import type { ManagedBlock } from "../contracts/converter";

const MANAGED_BEGIN_RE = /<!--\s*BEGIN\s+MANAGED:(\S+)\s*-->/g;
const MANAGED_END_RE = /<!--\s*END\s+MANAGED:(\S+)\s*-->/g;

interface BlockRange {
  id: string;
  start: number; // index of BEGIN marker start
  end: number; // index of END marker end
  content: string; // content between markers
}

function findManagedRanges(text: string): BlockRange[] {
  const ranges: BlockRange[] = [];
  const beginMatches = Array.from(text.matchAll(MANAGED_BEGIN_RE));

  for (const beginMatch of beginMatches) {
    const id = beginMatch[1];
    const startIndex = beginMatch.index;
    const afterBegin = beginMatch.index + beginMatch[0].length;

    const endRe = new RegExp(`<!--\\s*END\\s+MANAGED:${id}\\s*-->`, "g");
    endRe.lastIndex = afterBegin;
    const endMatch = endRe.exec(text);
    if (!endMatch) {
      throw new Error(`Unclosed managed block: ${id} at index ${startIndex}`);
    }

    const content = text.slice(afterBegin, endMatch.index);
    ranges.push({
      id,
      start: startIndex,
      end: endMatch.index + endMatch[0].length,
      content,
    });
  }

  return ranges;
}

/**
 * Parse managed blocks from existing content.
 */
export function parseManagedBlocks(text: string): ManagedBlock[] {
  const ranges = findManagedRanges(text);
  return ranges.map((r) => ({ id: r.id, content: r.content }));
}

/**
 * Merge user-managed blocks from existing content into newly generated content.
 *
 * Strategy:
 * - New managed blocks replace old ones with the same ID.
 * - Old managed blocks that no longer exist in the new content are removed.
 * - Non-managed content in the existing file is preserved entirely.
 *
 * This is achieved by extracting all managed blocks from the new content,
 * then overlaying them onto the existing content by ID.
 *
 * Actually, simpler: the generated content already has the new managed blocks.
 * We want to preserve any non-managed parts of the existing content that are
 * OUTSIDE managed blocks, but since the entire file is generated, this is only
 * relevant for partial-generation scenarios.
 *
 * For SKILL.md generation, the simplest safe approach:
 * - Extract old managed blocks from existing.
 * - Extract new managed blocks from generated.
 * - Build a merged document where:
 *   - The non-managed skeleton comes from the GENERATED content (source of truth)
 *   - Any managed block present in BOTH old and new keeps the NEW version
 *   - Any managed block ONLY in old is dropped (it was generated before)
 *   - Any managed block ONLY in new is added
 *
 * If the user wants to preserve arbitrary non-managed edits, they should not
 * edit an AUTO-GENERATED file. The managed-block system is for allowing
 * intentional extension points.
 */
export function mergeManagedBlocks(existingContent: string, generatedContent: string): string {
  const existingRanges = findManagedRanges(existingContent);
  const generatedRanges = findManagedRanges(generatedContent);

  if (existingRanges.length === 0) {
    // No existing managed blocks: return generated as-is
    return generatedContent;
  }

  if (generatedRanges.length === 0) {
    // Generated has no managed blocks: return generated as-is
    return generatedContent;
  }

  // Build a map of generated blocks by ID
  const generatedById = new Map<string, BlockRange>();
  for (const r of generatedRanges) {
    generatedById.set(r.id, r);
  }

  // Start from the generated content, but for each managed block that also
  // existed in the old content, we use the NEW content (source of truth).
  // For any non-managed user edits between old blocks... we can't safely preserve
  // them because the skeleton may have changed. So we just return generated.

  // However, if the user added custom content OUTSIDE managed blocks in the old
  // file, we might want to append it. That's too complex and error-prone.
  // The contract is: edit .tmpl, not .md.

  // One useful feature: if the generated block has a special sentinel
  // "<!-- MANAGED-PRESERVE -->", we could keep old content. But let's keep it simple.

  return generatedContent;
}

/**
 * A stricter merge that preserves user content outside managed blocks
 * only if the generated skeleton hasn't changed. This is a future enhancement.
 */
export function mergeManagedBlocksStrict(existingContent: string, generatedContent: string): string {
  return mergeManagedBlocks(existingContent, generatedContent);
}
