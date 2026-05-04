import type { SkillDocument } from "../contracts/converter";

export interface TemplateVars {
  [key: string]: string | Record<string, string>;
}

/**
 * Render {{VAR}} and {{REFERENCE:name}} placeholders in a raw skill source.
 * This operates on raw strings BEFORE parsing, preserving the existing
 * gen-skill-docs behavior but extracted into a dedicated module.
 */
export function renderTemplate(source: string, vars: TemplateVars): string {
  let result = source;
  for (const [key, value] of Object.entries(vars)) {
    if (typeof value === "string") {
      result = result.replaceAll(`{{${key}}}`, value);
    } else if (key === "references" && typeof value === "object" && value !== null) {
      for (const [refName, refContent] of Object.entries(value)) {
        result = result.replaceAll(`{{REFERENCE:${refName}}}`, refContent as string);
      }
    }
  }
  return result;
}

/**
 * Apply template variables to a SkillDocument by re-rendering its raw source.
 * This is a convenience for the existing pipeline where template vars are
 * resolved before parsing.
 */
export function applyTemplateVars(doc: SkillDocument, vars: TemplateVars): SkillDocument {
  const rendered = renderTemplate(doc.raw, vars);
  // Return a document with updated raw; caller can re-parse if needed.
  return { ...doc, raw: rendered };
}
