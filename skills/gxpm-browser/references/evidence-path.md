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
