#!/bin/bash
# gxpm SessionStart hook for Codex CLI
# Reads JSON from stdin, injects active gxpm issues as additionalContext.
#
# Codex provides on stdin: {session_id, transcript_path, cwd, hook_event_name, model, source}
# We respond with JSON: {hookSpecificOutput: {hookEventName, additionalContext}}

set -e

if ! command -v gxpm >/dev/null 2>&1; then exit 0; fi
if ! command -v python3 >/dev/null 2>&1; then exit 0; fi

INPUT=$(cat)
CWD=$(printf '%s' "$INPUT" | python3 -c 'import sys,json
try:
    print(json.load(sys.stdin).get("cwd",""))
except Exception:
    print("")
')

if [ -z "$CWD" ] || [ ! -d "$CWD/.gxpm/issues" ]; then
  exit 0
fi

cd "$CWD"
# Try active issues first; if none, fall back to recent landed for context.
ACTIVE_JSON=$(gxpm issue list --json 2>/dev/null || echo "[]")
RECENT_JSON=$(gxpm issue list --recent 3 --json 2>/dev/null || echo "[]")

printf '%s\t%s' "$ACTIVE_JSON" "$RECENT_JSON" | python3 -c '
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

print(json.dumps({
    "hookSpecificOutput": {
        "hookEventName": "SessionStart",
        "additionalContext": "\n".join(parts)
    }
}))
'
