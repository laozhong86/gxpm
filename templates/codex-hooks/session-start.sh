#!/bin/bash
# gxpm SessionStart hook for Codex CLI
# Reads JSON from stdin, injects a short gxpm capability hint and optional
# update-check notice as additionalContext.
#
# Codex provides on stdin: {session_id, transcript_path, cwd, hook_event_name, model, source}
# We respond with JSON: {hookSpecificOutput: {hookEventName, additionalContext}}

set -e

if [ "${GXPM_SESSION_START_DISABLE:-}" = "1" ]; then exit 0; fi
if ! command -v python3 >/dev/null 2>&1; then exit 0; fi

INPUT=$(cat)
CWD=$(printf '%s' "$INPUT" | python3 -c 'import sys,json
try:
    print(json.load(sys.stdin).get("cwd",""))
except Exception:
    pass
')

WORKTREE_CONTEXT=""
if [ -n "$CWD" ] && [ -d "$CWD/.git" ]; then
  cd "$CWD" || true
  branch=$(git symbolic-ref --short HEAD 2>/dev/null || echo "")
  if [ -n "$branch" ] && [ "$branch" != "main" ] && [ "$branch" != "master" ]; then
    git_path=$(git rev-parse --git-path HEAD 2>/dev/null || echo "")
    if ! echo "$git_path" | grep -q "/worktrees/"; then
      WORKTREE_CONTEXT="WARNING: You are on branch '$branch' in the canonical main checkout. gxpm worktree.enforcement is required. Create a worktree before editing code: gxpm workspace ensure <issue-id>"
    fi
  fi
fi

STATIC_CONTEXT=""
if [ -n "$CWD" ] && [ -d "$CWD/.gxpm/issues" ]; then
  SCHEMA="1"
  STATE_FILE="$CWD/core/state.ts"
  if [ -f "$STATE_FILE" ]; then
    SCHEMA_CANDIDATE=$(python3 -c 'import re, sys; text=open(sys.argv[1], encoding="utf-8").read(); match=re.search(r"\bCURRENT_SCHEMA_VERSION\s*=\s*([0-9]+)\b", text); print(match.group(1) if match else "")' "$STATE_FILE" 2>/dev/null || true)
    if [ -n "$SCHEMA_CANDIDATE" ]; then
      SCHEMA="$SCHEMA_CANDIDATE"
    fi
  fi

  VERSION="dev"
  VERSION_FILE="$CWD/VERSION"
  if [ -f "$VERSION_FILE" ]; then
    VERSION_CANDIDATE=$(sed -n '1{s/^[[:space:]]*//;s/[[:space:]]*$//;p;q;}' "$VERSION_FILE" 2>/dev/null || true)
    if [ -n "$VERSION_CANDIDATE" ]; then
      VERSION="${VERSION_CANDIDATE:0:40}"
    fi
  fi

  STATIC_CONTEXT="This repo uses gxpm (schema v$SCHEMA, version $VERSION). Run \`gxpm issue list\` to see active work, \`gxpm issue status <id>\` to load context."
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

WIKI_JSON="{}"
if [ -n "$CWD" ] && [ -d "$CWD" ] && command -v gxpm >/dev/null 2>&1; then
  WIKI_JSON=$(cd "$CWD" && gxpm wiki status --json 2>/dev/null || echo "{}")
fi

# Trigger background wiki update if stale
if [ -n "$CWD" ] && [ -d "$CWD" ] && command -v gxpm >/dev/null 2>&1; then
  (cd "$CWD" && gxpm wiki update >/dev/null 2>&1 &) || true
fi

export STATIC_CONTEXT UPDATE_CONTEXT WIKI_JSON WORKTREE_CONTEXT
python3 -c 'import json, os, sys
parts = [p for p in [os.environ.get("WORKTREE_CONTEXT", ""), os.environ.get("STATIC_CONTEXT", ""), os.environ.get("UPDATE_CONTEXT", "")] if p]
try:
    wiki = json.loads(os.environ.get("WIKI_JSON", "{}"))
except Exception:
    wiki = {}
if not isinstance(wiki, dict):
    wiki = {}
native = wiki.get("native", wiki)
if native.get("detected"):
    wiki_parts = ["gxpm native wiki detected ({}.gxpm/wiki{}).".format(native.get("repoWikiRoot", ""), " stale" if native.get("stale") else "")]
    if native.get("stale"):
        wiki_parts.append("Auto-updating wiki in background. Results may be stale for the first query.")
    docs = native.get("docs", [])
    if docs:
        wiki_parts.append("Docs: {}".format(", ".join(docs[:3])))
    parts.append("\n".join(wiki_parts))
if not parts:
    sys.exit(0)
print(json.dumps({"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": "\n\n".join(parts)}}))'
