---
name: gxpm-browser
description: 无头浏览器自动化，用于 QA 证据捕获。截图、验证元素、填表、捕获 issue 证据。
status: stable
---
<!-- AUTO-GENERATED from SKILL.md.tmpl - do not edit directly -->

# gxpm-browser

Minimal headless browser CLI built on Playwright. Designed for gxpm evidence
capture and QA automation, not general web scraping.

## When to trigger

- User asks to "test the site", "open in browser", "take a screenshot"
- QA phase needs browser/runtime proof
- Verify-gate requires visual evidence
- User describes a bug that needs reproduction with screenshot

## Commands

### Navigate and inspect

```bash
gxpm-browser navigate <url> [--json]
```

Returns page title and final URL after `networkidle`.

### Screenshot evidence

```bash
gxpm-browser screenshot <url> [--out <path>] [--full-page] [--json]
```

Default output: `/tmp/gxpm-browser-<ts>.png`.
If run inside a repo with an active issue, pass `--issueid <id>` to write to
`.gxpm/issues/<id>/evidence/browser/` automatically.

### Assert element text

```bash
gxpm-browser assert <url> --selector <css> --text <expected> [--json]
```

Exits 1 if the first matching element does not contain the expected text.
Use this for pass/fail QA gates.

### Interact

```bash
gxpm-browser click <url> --selector <css> [--json]
gxpm-browser type <url> --selector <css> --text <value> [--json]
```

### Headed mode for debugging

```bash
gxpm-browser screenshot <url> --no-headless
```

Opens a visible Chrome window. Use sparingly; default is headless.


## Evidence path

When `--issueid` is provided, screenshots are written to:

```
.gxpm/issues/<issue-id>/evidence/browser/screenshot-<ts>.png
```

Link them in `qa-findings` or `verify-findings` artifacts:

```bash
gxpm artifact write <issue-id> qa-findings --json '{"evidence":["browser/screenshot-12345.png"]}'
```

## Limitations

- Uses Chromium/Chrome via Playwright. Requires Chrome or `playwright install chromium`.
- No persistent session state between commands (each command launches a fresh browser).
- No network interception or request mocking; use `agent-browser` for advanced automation.
- cmux browser session investigation is a separate path (see main gxpm skill).


## Read Next

- `docs/governance/development-contract.md`
- Main `/gxpm` skill for QA phase gate details
