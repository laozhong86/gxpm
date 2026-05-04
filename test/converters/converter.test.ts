import { describe, expect, test } from "bun:test";
import { SkillParser } from "../../core/converters/parser";
import { HostConverter, filterFrontmatter, buildPreamble } from "../../core/converters/converter";
import { getHostConfig } from "../../hosts";

describe("filterFrontmatter", () => {
  test("preserves all keys for claude host", () => {
    const host = getHostConfig("claude");
    const fm = { name: "x", description: "y", extra: "z" };
    expect(filterFrontmatter(fm, host)).toEqual(fm);
  });

  test("allowlists only declared keys for codex host", () => {
    const host = getHostConfig("codex");
    const fm = { name: "x", description: "y", extra: "z", mode: "preserve" };
    expect(filterFrontmatter(fm, host)).toEqual({ name: "x", description: "y" });
  });
});

describe("buildPreamble", () => {
  test("claude preamble does not include env vars", () => {
    const host = getHostConfig("claude");
    const preamble = buildPreamble(host);
    expect(preamble).toContain("Claude Code");
    expect(preamble).not.toContain("GXPM_STATE_DIR");
  });

  test("codex preamble includes env vars", () => {
    const host = getHostConfig("codex");
    const preamble = buildPreamble(host);
    expect(preamble).toContain("OpenAI Codex CLI");
    expect(preamble).toContain("GXPM_STATE_DIR");
  });
});

describe("HostConverter", () => {
  test("injects preamble after first heading", () => {
    const source = ["---", "name: test", "---", "", "# Title", "", "Body."].join("\n");
    const parser = new SkillParser();
    const doc = parser.parse(source);

    const converter = new HostConverter();
    const converted = converter.convert(doc, { hostName: "claude" });

    expect(converted.body.length).toBe(3); // heading + preamble + paragraph
    expect(converted.body[0].type).toBe("heading");
    expect(converted.body[1].type).toBe("raw");
    expect(converted.body[1].content).toContain("Claude Code");
    expect(converted.body[2].type).toBe("paragraph");
  });

  test("filters frontmatter for codex", () => {
    const source = ["---", "name: test", "description: desc", "extra: bad", "---", "", "# T"].join("\n");
    const parser = new SkillParser();
    const doc = parser.parse(source);

    const converter = new HostConverter();
    const converted = converter.convert(doc, { hostName: "codex" });

    expect(converted.frontmatter).toEqual({ name: "test", description: "desc" });
  });
});
