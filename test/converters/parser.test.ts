import { describe, expect, test } from "bun:test";
import { SkillParser } from "../../core/converters/parser";

describe("SkillParser", () => {
  test("parses frontmatter and body sections", () => {
    const source = [
      "---",
      "name: gxpm",
      "description: test",
      "---",
      "",
      "# Heading 1",
      "",
      "Some paragraph text.",
      "",
      "```bash",
      "echo hello",
      "```",
      "",
      "> blockquote",
      "",
      "- item one",
      "- item two",
    ].join("\n");

    const parser = new SkillParser();
    const doc = parser.parse(source);

    expect(doc.frontmatter).toEqual({ name: "gxpm", description: "test" });
    expect(doc.body.length).toBe(5);
    expect(doc.body[0]).toEqual({ type: "heading", content: "# Heading 1", level: 1 });
    expect(doc.body[1]).toEqual({ type: "paragraph", content: "Some paragraph text." });
    expect(doc.body[2]).toEqual({ type: "code", content: "```bash\necho hello\n```", lang: "bash" });
    expect(doc.body[3]).toEqual({ type: "blockquote", content: "> blockquote" });
    expect(doc.body[4]).toEqual({ type: "list", content: "- item one\n- item two" });
  });

  test("parses document without frontmatter", () => {
    const source = "# Title\n\nBody text.";
    const parser = new SkillParser();
    const doc = parser.parse(source);

    expect(doc.frontmatter).toEqual({});
    expect(doc.body.length).toBe(2);
    expect(doc.body[0].type).toBe("heading");
    expect(doc.body[1].type).toBe("paragraph");
  });

  test("extracts managed blocks when option is set", () => {
    const source = [
      "---",
      "name: test",
      "---",
      "",
      "# Title",
      "",
      "<!-- BEGIN MANAGED:commands -->",
      "```bash",
      "gxpm status",
      "```",
      "<!-- END MANAGED:commands -->",
      "",
      "User content here.",
    ].join("\n");

    const parser = new SkillParser();
    const doc = parser.parse(source, { extractManagedBlocks: true });

    expect(doc.managedBlocks).toEqual([
      { id: "commands", content: "\n```bash\ngxpm status\n```\n" },
    ]);
    expect(doc.body.some((s) => s.content.includes("MANAGED"))).toBe(false);
  });

  test("throws on unclosed managed block", () => {
    const source = "<!-- BEGIN MANAGED:x -->\ncontent\n";
    const parser = new SkillParser();
    expect(() => parser.parse(source, { extractManagedBlocks: true })).toThrow("Unclosed managed block");
  });

  test("preserves raw source", () => {
    const source = "# Hello\n\nWorld.";
    const parser = new SkillParser();
    const doc = parser.parse(source);
    expect(doc.raw).toBe(source);
  });
});
