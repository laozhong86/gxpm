---
name: gxpm-browser
type: reference
description: MUST use during the qa phase before transitioning to land. Headless browser automation for QA evidence capture. Use when user asks to test a web page, take a screenshot, verify an element, fill a form, or capture browser evidence for an issue.
status: stable
---
<!-- AUTO-GENERATED from SKILL.md.tmpl - do not edit directly -->

**Announce at start:** "I am using the gxpm-browser skill to capture headless-browser QA evidence — screenshots, asserts on rendered DOM, form interactions — that the local test suite cannot prove on its own."

# gxpm-browser

Minimal headless browser CLI built on Playwright. Designed for gxpm evidence
capture and QA automation, not general web scraping.

## When to trigger（入口条件）

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

### Session persistence (storage-state)

All subcommands accept two opt-in flags for reusing an authenticated Playwright
session across runs:

```bash
gxpm-browser <cmd> <url> --storage-state <path>        # load session before navigate
gxpm-browser <cmd> <url> --save-storage-state <path>   # write session after command
gxpm-browser <cmd> <url> --issueid <id> --save-storage-state   # default to issue evidence dir
```

Default behaviour without flags stays stateless. See the persistence section in
`references/evidence-path.md` for chained-command examples.


## Evidence path

When `--issueid` is provided, screenshots are written to:

```
.gxpm/issues/<issue-id>/evidence/browser/screenshot-<ts>.png
```

Link them in `qa-findings` or `verify-findings` artifacts:

```bash
gxpm artifact write <issue-id> qa-findings --json '{"evidence":["browser/screenshot-12345.png"]}'
```

## Persistence (storage-state reuse)

Each command launches a fresh browser context by default (stateless). To carry an
authenticated session across commands without re-running `browse:auth`, opt in
with the storage-state flags:

```bash
# First command — capture session
gxpm-browser navigate https://app.example.com/login --save-storage-state /tmp/session.json

# Follow-up command — reuse session
gxpm-browser screenshot https://app.example.com/chat --storage-state /tmp/session.json
```

When `--issueid <id>` is set and `--save-storage-state` is passed without an
explicit path, the file defaults to:

```
.gxpm/issues/<id>/evidence/browser/storage-state.json
```

This path is covered by the repo's `.gxpm/` gitignore rule. Storage-state files
contain auth tokens — treat them as secrets and never commit them.

## Limitations

- Uses Chromium/Chrome via Playwright. Requires Chrome or `playwright install chromium`.
- Storage-state reuse is opt-in via `--storage-state` / `--save-storage-state`; default behaviour stays stateless.
- No network interception or request mocking; use `agent-browser` for advanced automation.
- cmux browser session investigation is a separate path (see main gxpm skill).


## Red Flags（红旗清单 / 反模式）

- **禁止用于通用网页抓取** — 本 skill 仅限 gxpm 证据捕获与 QA 自动化
- 不要在没有明确 QA 需求或证据要求时随意截图
- 不要在 verify-gate 未要求时产生冗余的浏览器证据

## Verification（验证清单 / 出口条件）

- [ ] 浏览器操作成功执行（页面加载、元素验证、截图等）
- [ ] 证据文件保存到正确路径并可在后续 QA 环节引用
- [ ] 截图/记录与 issue 中描述的 bug 或验收标准对应
- [ ] 相关证据已归档或链接到 verify-gate 交付物

## Read Next

- `docs/governance/development-contract.md`
- Main `/gxpm` skill for QA phase gate details

## Terminal State

完成 `qa-findings` artifact 后：

1. `gxpm artifact write <issue-id> qa-findings --from <file>` 落盘 browser evidence（runtime-only / 无 UI 改动时记 `status: n/a` + 理由）。
2. `gxpm issue transition <issue-id> qa` 已是 qa 阶段；继续 `gxpm qa land <issue-id>` 初始化 `land-findings`。
3. 写完 `land-findings` 后 `gxpm issue transition <issue-id> land`（terminal phase）。
4. 从 main repo 根执行 `gxpm cleanup land <issue-id> --execute` 归档 issue 并清理 worktree。
