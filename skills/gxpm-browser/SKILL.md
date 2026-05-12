---
name: gxpm-browser
description: Headless browser automation for QA evidence capture. Use when user asks to test a web page, take a screenshot, verify an element, fill a form, or capture browser evidence for an issue.
status: stable
---
<!-- AUTO-GENERATED from SKILL.md.tmpl - do not edit directly -->

# gxpm-browser

Minimal headless browser CLI built on Playwright. Designed for gxpm evidence
capture and QA automation, not general web scraping.

## 入口条件

- User asks to "test the site", "open in browser", "take a screenshot"
- QA phase needs browser/runtime proof
- Verify-gate requires visual evidence
- User describes a bug that needs reproduction with screenshot

## 可操作流程

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


## 红旗清单 / 反模式

- **禁止用于通用网页抓取** — 本 skill 仅限 gxpm 证据捕获与 QA 自动化
- 不要在没有明确 QA 需求或证据要求时随意截图
- 不要在 verify-gate 未要求时产生冗余的浏览器证据

## 验证清单 / 出口条件

- [ ] 浏览器操作成功执行（页面加载、元素验证、截图等）
- [ ] 证据文件保存到正确路径并可在后续 QA 环节引用
- [ ] 截图/记录与 issue 中描述的 bug 或验收标准对应
- [ ] 相关证据已归档或链接到 verify-gate 交付物

## Read Next

- `docs/governance/development-contract.md`
- Main `/gxpm` skill for QA phase gate details
