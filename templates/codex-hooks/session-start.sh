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
gxpm issue list --json 2>/dev/null | python3 -c '
import json, sys
try:
    issues = json.load(sys.stdin)
except Exception:
    sys.exit(0)
if not issues:
    sys.exit(0)
lines = []
for i in issues[:5]:
    issue_id = i["issueId"]
    phase = i["currentPhase"]
    updated = i["updatedAt"][:19] + "Z"
    lines.append("  - {} (phase={}, updated={})".format(issue_id, phase, updated))
context = "Active gxpm issues in this repo:\n" + "\n".join(lines) + "\n\nResume with: gxpm issue next <id>  /  gxpm issue history <id>  /  gxpm artifact list <id>"
print(json.dumps({
    "hookSpecificOutput": {
        "hookEventName": "SessionStart",
        "additionalContext": context
    }
}))
'
