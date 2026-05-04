import { describe, expect, test } from "bun:test";
import { SkillParser, HostConverter, SkillWriter } from "../../core/converters";

describe("Converter pipeline (integration)", () => {
  test("end-to-end: parse -> convert (codex) -> write", () => {
    const source = [
      "---",
      "name: gxpm",
      "description: test",
      "mode: preserve",
      "---",
      "",
      "# gxpm",
      "",
      "Body content here.",
      "",
      "```bash",
      "gxpm status",
      "```",
    ].join("\n");

    const parser = new SkillParser();
    const converter = new HostConverter();
    const writer = new SkillWriter();

    const doc = parser.parse(source);
    const converted = converter.convert(doc, { hostName: "codex" });
    const output = writer.write(converted);

    expect(output).toContain("name: gxpm");
    expect(output).toContain("description: test");
    expect(output).not.toContain("mode: preserve"); // filtered by codex allowlist
    expect(output).toContain("# gxpm");
    expect(output).toContain("OpenAI Codex CLI");
    expect(output).toContain("GXPM_STATE_DIR");
    expect(output).toContain("Body content here.");
    expect(output).toContain("```bash");
  });

  test("end-to-end: parse -> convert (claude) -> write with generated mark", () => {
    const source = [
      "---",
      "name: test",
      "description: test",
      "---",
      "",
      "# Title",
      "",
      "Text.",
    ].join("\n");

    const parser = new SkillParser();
    const converter = new HostConverter();
    const writer = new SkillWriter();

    const doc = parser.parse(source);
    const converted = converter.convert(doc, { hostName: "claude" });
    const output = writer.write(converted, { generatedMark: "<!-- AUTO-GENERATED -->" });

    expect(output).toContain("<!-- AUTO-GENERATED -->");
    expect(output).toContain("Claude Code");
    expect(output).not.toContain("GXPM_STATE_DIR");
    expect(output).toContain("name: test");
  });

  test("managed blocks survive the round trip", () => {
    const source = [
      "---",
      "name: test",
      "---",
      "",
      "# Title",
      "",
      "<!-- BEGIN MANAGED:dynamic -->",
      "dynamic content",
      "<!-- END MANAGED:dynamic -->",
    ].join("\n");

    const parser = new SkillParser();
    const converter = new HostConverter();
    const writer = new SkillWriter();

    const doc = parser.parse(source, { extractManagedBlocks: true });
    const converted = converter.convert(doc, { hostName: "codex" });
    const output = writer.write(converted);

    expect(output).toContain("<!-- BEGIN MANAGED:dynamic -->");
    expect(output).toContain("dynamic content");
    expect(output).toContain("<!-- END MANAGED:dynamic -->");
  });
});
