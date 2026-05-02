#!/usr/bin/env bun
/**
 * gxpm-browser — minimal headless browser CLI for QA evidence capture.
 *
 * Uses Playwright to drive Chromium/Chrome in headless mode.
 * Screenshots and evidence are written to the gxpm evidence store when
 * an issue-id is provided.
 */

import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";

const args = process.argv.slice(2);
const command = args[0];

function usage() {
  console.log(`gxpm-browser — headless browser for QA evidence

Usage:
  gxpm-browser navigate <url> [--json]
  gxpm-browser screenshot <url> [--out <path>] [--full-page] [--json]
  gxpm-browser assert <url> --selector <css> --text <expected> [--json]
  gxpm-browser click <url> --selector <css> [--json]
  gxpm-browser type <url> --selector <css> --text <value> [--json]

Options:
  --out <path>       Screenshot output path (default: /tmp/gxpm-browser-<ts>.png)
  --full-page        Capture full page instead of viewport
  --selector <css>   CSS selector for element interaction
  --text <value>     Text to assert or type
  --json             Output JSON
  --headless         Run headless (default: true)
  --no-headless      Run headed for debugging
`);
}

function parseFlags(argv: string[]) {
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") {
      flags.json = true;
    } else if (arg === "--full-page") {
      flags.fullPage = true;
    } else if (arg === "--headless") {
      flags.headless = true;
    } else if (arg === "--no-headless") {
      flags.headless = false;
    } else if (arg.startsWith("--")) {
      const key = arg.replace(/^--/, "").replace(/-/g, "");
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }
  return { flags, positional };
}

function output(data: unknown, asJson: boolean) {
  if (asJson) {
    console.log(JSON.stringify(data, null, 2));
  } else {
    console.log(data);
  }
}

function resolveEvidencePath(issueId: string | undefined, label: string): string | undefined {
  if (!issueId) return undefined;
  const repoRoot = process.cwd();
  const evidenceDir = join(repoRoot, ".gxpm", "issues", issueId, "evidence", "browser");
  mkdirSync(evidenceDir, { recursive: true });
  const ts = Date.now();
  const filename = `${label}-${ts}.png`;
  return join(evidenceDir, filename);
}

async function run() {
  if (!command || command === "--help" || command === "-h") {
    usage();
    process.exit(0);
  }

  const { flags, positional } = parseFlags(args.slice(1));
  const asJson = !!flags.json;
  const headless = flags.headless !== false;
  const url = positional[0];

  if (!url) {
    output({ error: "Missing URL" }, asJson);
    process.exit(1);
  }

  const browser = await chromium.launch({
    headless,
    executablePath: process.env.GXPM_BROWSER_EXECUTABLE || undefined,
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: "networkidle" });

    switch (command) {
      case "navigate": {
        const title = await page.title();
        output({ url: page.url(), title }, asJson);
        break;
      }

      case "screenshot": {
        const outPath =
          (flags.out as string) ||
          resolveEvidencePath(flags.issueid as string | undefined, "screenshot") ||
          `/tmp/gxpm-browser-${Date.now()}.png`;
        const fullPage = !!flags.fullPage;
        await page.screenshot({ path: outPath, fullPage });
        output({ screenshot: resolve(outPath), url: page.url(), fullPage }, asJson);
        break;
      }

      case "assert": {
        const selector = flags.selector as string;
        const expected = flags.text as string;
        if (!selector || expected === undefined) {
          output({ error: "Missing --selector or --text" }, asJson);
          process.exit(1);
        }
        const el = await page.locator(selector).first();
        const text = await el.textContent();
        const pass = text?.includes(expected) ?? false;
        output({ pass, expected, actual: text, selector }, asJson);
        if (!pass) process.exit(1);
        break;
      }

      case "click": {
        const selector = flags.selector as string;
        if (!selector) {
          output({ error: "Missing --selector" }, asJson);
          process.exit(1);
        }
        await page.locator(selector).first().click();
        output({ clicked: selector, url: page.url() }, asJson);
        break;
      }

      case "type": {
        const selector = flags.selector as string;
        const value = flags.text as string;
        if (!selector || value === undefined) {
          output({ error: "Missing --selector or --text" }, asJson);
          process.exit(1);
        }
        await page.locator(selector).first().fill(value);
        output({ filled: selector, value, url: page.url() }, asJson);
        break;
      }

      default: {
        output({ error: `Unknown command: ${command}` }, asJson);
        process.exit(1);
      }
    }
  } finally {
    await context.close();
    await browser.close();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
