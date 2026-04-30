import { describe, expect, test } from "bun:test";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ensureQoderWikiLink } from "../core/qoder";
import { output, runCli } from "./helpers/workflow";

const repoRoot = resolve(import.meta.dir, "..");

describe("Qoder wiki local link", () => {
  test("creates .qoder/repowiki as a symlink to the shared local store", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-qoder-link-root-"));
    const sharedRoot = join(root, ".gxpm", "local", "qoder", "repowiki");

    const result = ensureQoderWikiLink({ root, sharedRoot });

    const linkPath = join(root, ".qoder", "repowiki");
    expect(result.action).toBe("linked");
    expect(existsSync(sharedRoot)).toBe(true);
    expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);
    expect(readlinkSync(linkPath)).toBe(sharedRoot);
  });

  test("is idempotent when the link already points at the shared store", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-qoder-link-idem-"));
    const sharedRoot = join(root, ".gxpm", "local", "qoder", "repowiki");

    ensureQoderWikiLink({ root, sharedRoot });
    const result = ensureQoderWikiLink({ root, sharedRoot });

    expect(result.action).toBe("already-linked");
    expect(lstatSync(join(root, ".qoder", "repowiki")).isSymbolicLink()).toBe(true);
  });

  test("refuses to overwrite a real repowiki directory unless replace is explicit", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-qoder-link-real-"));
    const existing = join(root, ".qoder", "repowiki");
    mkdirSync(existing, { recursive: true });
    writeFileSync(join(existing, "keep.md"), "# keep\n");

    expect(() => ensureQoderWikiLink({ root })).toThrow("refusing to replace");
    expect(readFileSync(join(existing, "keep.md"), "utf8")).toBe("# keep\n");
  });

  test("moves an existing real repowiki directory into the shared store with replace", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-qoder-link-replace-"));
    const existing = join(root, ".qoder", "repowiki");
    const sharedRoot = join(root, ".gxpm", "local", "qoder", "repowiki");
    mkdirSync(existing, { recursive: true });
    writeFileSync(join(existing, "keep.md"), "# keep\n");

    const result = ensureQoderWikiLink({ root, sharedRoot, replace: true });

    expect(result.action).toBe("moved-and-linked");
    expect(readFileSync(join(sharedRoot, "keep.md"), "utf8")).toBe("# keep\n");
    expect(lstatSync(existing).isSymbolicLink()).toBe(true);
    expect(readlinkSync(existing)).toBe(sharedRoot);
  });

  test("CLI links a target worktree to an explicit shared store", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-qoder-cli-root-"));
    const target = mkdtempSync(join(tmpdir(), "gxpm-qoder-cli-target-"));
    const sharedRoot = join(root, ".gxpm", "local", "qoder", "repowiki");

    const result = runCli(root, ["qoder", "link", "--target", target, "--shared-root", sharedRoot]);

    expect(result.exitCode).toBe(0);
    expect(output(result)).toContain("linked .qoder/repowiki");
    expect(readlinkSync(join(target, ".qoder", "repowiki"))).toBe(sharedRoot);
  });

  test("CLI rejects qoder link options without values", () => {
    const root = mkdtempSync(join(tmpdir(), "gxpm-qoder-cli-missing-value-"));

    const missingTarget = runCli(root, ["qoder", "link", "--target", "--replace"]);
    const missingSharedRoot = runCli(root, ["qoder", "link", "--shared-root"]);

    expect(missingTarget.exitCode).not.toBe(0);
    expect(output(missingTarget)).toContain("--target requires a value");
    expect(missingSharedRoot.exitCode).not.toBe(0);
    expect(output(missingSharedRoot)).toContain("--shared-root requires a value");
  });

  test(".gitignore keeps Qoder repowiki out of git status", () => {
    const ignore = readFileSync(join(repoRoot, ".gitignore"), "utf8");

    expect(ignore).toMatch(/^\.qoder\/repowiki$/m);
  });
});
