import type { Converter, ConvertOptions, SkillDocument, SkillFrontmatter, SkillSection } from "../contracts/converter";
import type { HostConfig } from "../contracts/host";
import { getHostConfig } from "../../hosts";

function filterFrontmatter(fm: SkillFrontmatter, host: HostConfig): SkillFrontmatter {
  if (host.frontmatter.mode === "preserve") {
    return { ...fm };
  }

  const allowed = new Set(host.frontmatter.keys);
  const filtered: SkillFrontmatter = {};
  for (const [key, value] of Object.entries(fm)) {
    if (allowed.has(key)) {
      filtered[key] = value;
    }
  }
  return filtered;
}

function buildPreamble(host: HostConfig): string {
  const lines: string[] = [];
  lines.push("## Host Preamble");
  lines.push("");
  lines.push(`Target host: ${host.displayName}.`);
  lines.push("");
  lines.push("```bash");

  if (host.usesEnvVars) {
    lines.push('GXPM_ROOT="${GXPM_ROOT:-$PWD}"');
    lines.push(`GXPM_STATE_DIR="\${GXPM_STATE_DIR:-$GXPM_ROOT/.gxpm}"`);
    lines.push("export GXPM_ROOT GXPM_STATE_DIR");
  } else {
    lines.push('GXPM_ROOT="${GXPM_ROOT:-$PWD}"');
    lines.push("export GXPM_ROOT");
  }

  lines.push("```");
  return lines.join("\n");
}

function injectPreambleSections(sections: SkillSection[], host: HostConfig): SkillSection[] {
  // Find the first heading after frontmatter (usually # Title)
  // Insert preamble right after it, before the next section.
  const preamble: SkillSection = {
    type: "raw",
    content: buildPreamble(host),
  };

  if (sections.length === 0) {
    return [preamble];
  }

  // Insert after the first heading if present, otherwise at top
  let insertIndex = 0;
  for (let i = 0; i < sections.length; i++) {
    if (sections[i].type === "heading") {
      insertIndex = i + 1;
      break;
    }
  }

  const result = [...sections];
  result.splice(insertIndex, 0, preamble);
  return result;
}

export class HostConverter implements Converter {
  convert(doc: SkillDocument, options: ConvertOptions): SkillDocument {
    const host = getHostConfig(options.hostName);

    // 1. Filter frontmatter
    const frontmatter = filterFrontmatter(doc.frontmatter, host);

    // 2. Inject host preamble into body sections
    let body = injectPreambleSections(doc.body, host);

    // 3. If templateVars include injected sections (like artifact commands),
    //    they are already resolved as raw blocks by the template renderer.
    //    We keep them as-is.

    // 4. Preserve managed blocks (they travel with the document)
    const managedBlocks = doc.managedBlocks.map((b) => ({ ...b }));

    return {
      frontmatter,
      body,
      managedBlocks,
      raw: doc.raw,
    };
  }
}

export { filterFrontmatter, buildPreamble };
