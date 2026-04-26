#!/bin/bash
# gxpm SessionStart hook for Codex CLI
# Reads JSON from stdin and emits optional additionalContext.
#
# Codex provides on stdin: {session_id, transcript_path, cwd, hook_event_name, model, source}
# We respond with JSON: {hookSpecificOutput: {hookEventName, additionalContext}}

set -e

if ! command -v python3 >/dev/null 2>&1; then exit 0; fi

INPUT=$(cat)
CWD=$(printf '%s' "$INPUT" | python3 -c 'import sys,json
try:
    print(json.load(sys.stdin).get("cwd",""))
except Exception:
    print("")
')

ISSUE_CONTEXT=""
if command -v gxpm >/dev/null 2>&1 && [ -n "$CWD" ] && [ -d "$CWD/.gxpm/issues" ]; then
  cd "$CWD"
  # Try active issues first; if none, fall back to recent landed for context.
  ACTIVE_JSON=$(gxpm issue list --json 2>/dev/null || echo "[]")
  RECENT_JSON=$(gxpm issue list --recent 3 --json 2>/dev/null || echo "[]")

  ISSUE_CONTEXT=$(printf '%s\t%s' "$ACTIVE_JSON" "$RECENT_JSON" | python3 -c '
import json, sys
raw = sys.stdin.read()
active_raw, recent_raw = raw.split("\t", 1)
try:
    active = json.loads(active_raw)
except Exception:
    active = []
try:
    recent = json.loads(recent_raw)
except Exception:
    recent = []

def fmt(issue):
    return "  - {} (phase={}, updated={})".format(
        issue["issueId"], issue["currentPhase"], issue["updatedAt"][:19] + "Z"
    )

parts = []
if active:
    parts.append("Active gxpm issues in this repo:")
    parts.extend(fmt(i) for i in active[:5])
elif recent:
    parts.append("No active gxpm issues. Most recently landed (for reference):")
    parts.extend(fmt(i) for i in recent[:3])
else:
    sys.exit(0)

parts.append("")
parts.append("Recommended commands when working an issue:")
parts.append("  gxpm issue next <id>      # what to do next")
parts.append("  gxpm issue history <id>   # full audit timeline")
parts.append("  gxpm issue create --auto-id  # start a new issue with next free id")

print("\n".join(parts))
')
fi

UPDATE_CONTEXT=""
UPDATE_CHECK_BIN="${GXPM_UPDATE_CHECK_BIN:-}"
if [ -z "$UPDATE_CHECK_BIN" ] && command -v gxpm-update-check >/dev/null 2>&1; then
  UPDATE_CHECK_BIN="$(command -v gxpm-update-check)"
fi

if [ -n "$UPDATE_CHECK_BIN" ] && [ -x "$UPDATE_CHECK_BIN" ]; then
  UPDATE_OUTPUT=$("$UPDATE_CHECK_BIN" 2>/dev/null || true)
  case "$UPDATE_OUTPUT" in
    UPGRADE_AVAILABLE*)
      OLD_VERSION=$(printf '%s' "$UPDATE_OUTPUT" | awk '{print $2}')
      NEW_VERSION=$(printf '%s' "$UPDATE_OUTPUT" | awk '{print $3}')
      if [ -n "$OLD_VERSION" ] && [ -n "$NEW_VERSION" ]; then
        UPDATE_CONTEXT="gxpm update available: ${OLD_VERSION} -> ${NEW_VERSION}."
      fi
      ;;
  esac
fi

if [ -z "$ISSUE_CONTEXT" ] && [ -z "$UPDATE_CONTEXT" ]; then
  exit 0
fi

export ISSUE_CONTEXT UPDATE_CONTEXT
python3 -c '
import json, os
parts = [p for p in [os.environ.get("ISSUE_CONTEXT", ""), os.environ.get("UPDATE_CONTEXT", "")] if p]
print(json.dumps({
    "hookSpecificOutput": {
        "hookEventName": "SessionStart",
        "additionalContext": "\n\n".join(parts)
    }
}))
'
