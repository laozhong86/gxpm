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
