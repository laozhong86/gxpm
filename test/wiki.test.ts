import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  extractCitedFiles,
  getQoderWikiStatus,
  markQoderWikiReminder,
  markQoderWikiSync,
} from "../core/wiki";

function tempRoot() {
  return mkdtempSync(join(tmpdir(), "gxpm-wiki-"));
}

function writeWikiPage(root: string, relativePath: string, content: string) {
  const path = join(root, ".qoder", "repowiki", "en", "content", relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

describe("Qoder wiki capability", () => {
  test("is optional when .qoder/repowiki is absent", () => {
    const root = tempRoot();

    const status = getQoderWikiStatus({ root, now: new Date("2026-04-27T00:00:00Z") });

    expect(status.detected).toBe(false);
    expect(status.state).toBe("absent");
    expect(status.pageCount).toBe(0);
    expect(status.reminder.reminderDue).toBe(false);
    expect(status.progressiveRead[0]).toContain("continue normal gxpm workflow");
  });

  test("summarizes markdown pages without requiring metadata reads", () => {
    const root = tempRoot();
    writeWikiPage(
      root,
      "Overview.md",
      "# Project Overview\n\n<cite>[state](file://core/state.ts#L1-L20)</cite>\n",
    );
    writeWikiPage(root, "Nested/Config.md", "# Config\n\n[cfg](file://core/config.ts)\n");
    const metadataPath = join(root, ".qoder", "repowiki", "en", "meta", "repowiki-metadata.json");
    mkdirSync(dirname(metadataPath), { recursive: true });
    writeFileSync(metadataPath, JSON.stringify({ huge: "metadata should not be surfaced" }));

    const status = getQoderWikiStatus({ root, now: new Date("2026-04-27T00:00:00Z") });

    expect(status.detected).toBe(true);
    expect(status.state).toBe("present");
    expect(status.contentRoots).toEqual([".qoder/repowiki/en/content"]);
    expect(status.pageCount).toBe(2);
    expect(status.topPages[0].path).toBe(".qoder/repowiki/en/content/Overview.md");
    expect(status.topPages[0].citedFiles).toContain("core/state.ts");
    expect(JSON.stringify(status)).not.toContain("metadata should not be surfaced");
  });

  test("extracts cited source files from wiki markdown", () => {
    expect(
      extractCitedFiles(
        "[a](file://core/state.ts#L1-L10)\n[b](file://scripts/gxpm.ts)\n[c](file://core/state.ts#L2)",
      ),
    ).toEqual(["core/state.ts", "scripts/gxpm.ts"]);
  });

  test("degrades safely when a wiki content directory is unreadable", () => {
    const root = tempRoot();
    const contentRoot = join(root, ".qoder", "repowiki", "en", "content");
    mkdirSync(contentRoot, { recursive: true });
    chmodSync(contentRoot, 0o000);

    try {
      const status = getQoderWikiStatus({ root, now: new Date("2026-04-27T00:00:00Z") });
      expect(status.detected).toBe(true);
      expect(["empty", "present"]).toContain(status.state);
    } finally {
      chmodSync(contentRoot, 0o700);
    }
  });

  test("tracks weekly sync and reminder evidence explicitly", () => {
    const root = tempRoot();
    writeWikiPage(root, "Overview.md", "# Overview\n");

    const first = getQoderWikiStatus({ root, now: new Date("2026-04-27T00:00:00Z") });
    expect(first.reminder.syncStale).toBe(true);
    expect(first.reminder.reminderDue).toBe(true);

    markQoderWikiReminder({
      root,
      now: new Date("2026-04-27T01:00:00Z"),
      note: "session-start reminder",
    });
    const afterReminder = getQoderWikiStatus({ root, now: new Date("2026-04-28T00:00:00Z") });
    expect(afterReminder.reminder.syncStale).toBe(true);
    expect(afterReminder.reminder.reminderDue).toBe(false);

    markQoderWikiSync({
      root,
      now: new Date("2026-04-28T01:00:00Z"),
      note: "manual qoder sync",
    });
    const statePath = join(root, ".gxpm", "wiki", "qoder.json");
    expect(existsSync(statePath)).toBe(true);
    expect(readFileSync(statePath, "utf8")).toContain("manual qoder sync");

    const afterSync = getQoderWikiStatus({ root, now: new Date("2026-04-29T00:00:00Z") });
    expect(afterSync.reminder.syncStale).toBe(false);
    expect(afterSync.reminder.reminderDue).toBe(false);
  });
});
