#!/bin/bash
set -e

if ! command -v python3 >/dev/null 2>&1; then exit 0; fi
if ! command -v gxpm >/dev/null 2>&1; then exit 0; fi

INPUT=$(cat)
CWD=$(printf '%s' "$INPUT" | python3 -c 'import json,sys
try:
    data=json.load(sys.stdin)
except Exception:
    raise SystemExit(0)
if data.get("tool_name") != "update_plan":
    raise SystemExit(0)
print(data.get("cwd",""))
') || exit 0

ARGS=$(printf '%s' "$INPUT" | python3 -c 'import json,sys
try:
    data=json.load(sys.stdin)
except Exception:
    raise SystemExit(0)
if data.get("tool_name") != "update_plan":
    raise SystemExit(0)
print(json.dumps({"tool_name": data.get("tool_name"), "arguments": data.get("arguments")}, ensure_ascii=False))
') || exit 0

record_error() {
  if [ -n "$CWD" ]; then
    mkdir -p "$CWD/.gxpm"
    printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" >> "$CWD/.gxpm/codex-plans-error.log"
  fi
  exit 0
}

if [ -z "$CWD" ] || [ ! -d "$CWD" ]; then exit 0; fi

ISSUE_JSON=$(cd "$CWD" && gxpm issue list --json 2>/dev/null) || record_error "issue list failed"
ISSUE_ID=$(printf '%s' "$ISSUE_JSON" | python3 -c 'import json,sys
try:
    data=json.load(sys.stdin)
except Exception:
    raise SystemExit(0)
print(data[0]["issueId"] if isinstance(data, list) and len(data) == 1 else "")
') || true

if [ -n "$ISSUE_ID" ]; then
  LOG_PATH="$CWD/.gxpm/issues/$ISSUE_ID/codex-plans.jsonl"
else
  LOG_PATH="$CWD/.gxpm/codex-plans-orphan.jsonl"
fi

mkdir -p "$(dirname "$LOG_PATH")" || record_error "mkdir failed"
printf '%s\n' "$ARGS" >> "$LOG_PATH" || record_error "append failed"
exit 0
