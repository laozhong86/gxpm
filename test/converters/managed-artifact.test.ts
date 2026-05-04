import { describe, expect, test } from "bun:test";
import { parseManagedBlocks, mergeManagedBlocks } from "../../core/converters/managed-artifact";

describe("parseManagedBlocks", () => {
  test("extracts managed blocks from existing content", () => {
    const text = [
      "# Title",
      "",
      "<!-- BEGIN MANAGED:commands -->",
      "```bash",
      "gxpm status",
      "```",
      "<!-- END MANAGED:commands -->",
      "",
      "User text.",
    ].join("\n");

    const blocks = parseManagedBlocks(text);
    expect(blocks).toEqual([{ id: "commands", content: "\n```bash\ngxpm status\n```\n" }]);
  });

  test("returns empty array when no managed blocks", () => {
    expect(parseManagedBlocks("# Hello\n\nWorld.")).toEqual([]);
  });

  test("throws on unclosed block", () => {
    expect(() => parseManagedBlocks("<!-- BEGIN MANAGED:x -->\ncontent")).toThrow("Unclosed managed block");
  });
});

describe("mergeManagedBlocks", () => {
  test("returns generated content when no existing managed blocks", () => {
    const generated = "<!-- BEGIN MANAGED:a -->\nnew\n<!-- END MANAGED:a -->";
    expect(mergeManagedBlocks("# Old", generated)).toBe(generated);
  });

  test("returns generated content when no generated managed blocks", () => {
    expect(mergeManagedBlocks("<!-- BEGIN MANAGED:a -->\nold\n<!-- END MANAGED:a -->", "# New")).toBe("# New");
  });

  test("replaces old managed block with new one of same ID", () => {
    const existing = [
      "# Title",
      "",
      "<!-- BEGIN MANAGED:cmds -->",
      "old",
      "<!-- END MANAGED:cmds -->",
    ].join("\n");

    const generated = [
      "# Title",
      "",
      "<!-- BEGIN MANAGED:cmds -->",
      "new",
      "<!-- END MANAGED:cmds -->",
    ].join("\n");

    const merged = mergeManagedBlocks(existing, generated);
    expect(merged).toContain("new");
    expect(merged).not.toContain("old");
  });
});
