// CONTRACT LAYER — zero external dependencies.
// Converter interfaces for multi-platform skill transformation.

export interface SkillFrontmatter {
  [key: string]: string | number | boolean | undefined;
}

export interface SkillSection {
  type: "heading" | "paragraph" | "code" | "blockquote" | "list" | "html" | "raw";
  content: string;
  level?: number; // for headings
  lang?: string; // for code blocks
}

export interface ManagedBlock {
  id: string;
  content: string;
}

export interface SkillDocument {
  frontmatter: SkillFrontmatter;
  body: SkillSection[];
  managedBlocks: ManagedBlock[];
  raw: string; // original raw source for passthrough cases
}

export interface ParseOptions {
  /** Whether to extract managed artifact blocks during parsing. */
  extractManagedBlocks?: boolean;
}

export interface Parser {
  parse(source: string, options?: ParseOptions): SkillDocument;
}

export interface ConvertOptions {
  hostName: string;
  /** Host-specific variables for template rendering. */
  templateVars?: Record<string, string>;
}

export interface Converter {
  convert(doc: SkillDocument, options: ConvertOptions): SkillDocument;
}

export interface WriteOptions {
  /** If provided, merge generated managed blocks with existing user content. */
  existingContent?: string;
  /** The generated mark to prepend (e.g. AUTO-GENERATED comment). */
  generatedMark?: string;
}

export interface TargetWriter {
  write(doc: SkillDocument, options?: WriteOptions): string;
}

export interface TransformPipeline {
  parser: Parser;
  converter: Converter;
  writer: TargetWriter;
}
