#!/bin/bash
# gxpm UserPromptSubmit hook for Codex CLI
# When the user's prompt mentions a tracked GXPM-N or GXG-N issue, inject its
# current status + recommended next step as additional context.
#
# Codex stdin: {session_id, transcript_path, cwd, hook_event_name, model, turn_id, prompt}
# We respond with stdout text (becomes additional developer context).

set -e

if ! command -v gxpm >/dev/null 2>&1; then exit 0; fi
if ! command -v python3 >/dev/null 2>&1; then exit 0; fi

INPUT=$(cat)

# Extract cwd + first GXPM/GXG reference, separated by tab
RESULT=$(printf '%s' "$INPUT" | python3 -c '
import json, re, sys
try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)
prompt = data.get("prompt", "")
cwd = data.get("cwd", "")
m = re.search(r"\b(GXG|GXPM)-\d+\b", prompt, re.IGNORECASE)
if not m:
    sys.exit(0)
print(cwd + "\t" + m.group(0).upper())
')

if [ -z "$RESULT" ]; then exit 0; fi

CWD=$(printf '%s' "$RESULT" | cut -f1)
ISSUE_ID=$(printf '%s' "$RESULT" | cut -f2)

if [ ! -f "$CWD/.gxpm/issues/$ISSUE_ID/state.json" ]; then exit 0; fi

# Print status + next-step guidance to stdout (becomes additional context)
{
  echo "gxpm context for $ISSUE_ID (referenced in prompt):"
  echo ""
  cd "$CWD" && gxpm issue status "$ISSUE_ID" 2>/dev/null
  echo ""
  cd "$CWD" && gxpm issue next "$ISSUE_ID" 2>/dev/null
} 2>/dev/null || exit 0
