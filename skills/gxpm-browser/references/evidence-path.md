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
