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
WIKI_JSON=$(gxpm wiki status --json 2>/dev/null || echo "{}")

printf '%s\t%s\t%s' "$ACTIVE_JSON" "$RECENT_JSON" "$WIKI_JSON" | python3 -c '
import json, sys
raw = sys.stdin.read()
parts_raw = raw.split("\t", 2)
active_raw = parts_raw[0] if len(parts_raw) > 0 else "[]"
recent_raw = parts_raw[1] if len(parts_raw) > 1 else "[]"
wiki_raw = parts_raw[2] if len(parts_raw) > 2 else "{}"
try:
    active = json.loads(active_raw)
except Exception:
    active = []
try:
    recent = json.loads(recent_raw)
except Exception:
    recent = []
try:
    wiki = json.loads(wiki_raw)
except Exception:
    wiki = {}

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

if wiki.get("detected"):
    if parts:
        parts.append("")
    parts.append("Qoder repo wiki detected (.qoder/repowiki).")
    parts.append("Before direct source reads, run `gxpm wiki status` and open the relevant wiki page(s).")
    top_pages = wiki.get("topPages") or []
    if top_pages:
        parts.append("Suggested wiki pages:")
        for page in top_pages[:3]:
            path = page.get("path")
            if path:
                parts.append("  - {}".format(path))
    reminder = wiki.get("reminder") or {}
    if reminder.get("reminderDue"):
        parts.append("")
        parts.append("Weekly Qoder wiki resync reminder: {}".format(reminder.get("reason", "manual sync evidence is stale")))
        parts.append("After reminding, record it with: gxpm wiki mark-reminder --note <reminder-note>")

if not parts:
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
