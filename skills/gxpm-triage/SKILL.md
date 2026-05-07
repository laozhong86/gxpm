---
name: gxpm-triage
description: 通过分类角色状态机处理问题。创建 issue、审查 bug/功能请求、管理工作流。
---

# Triage

Move issues through a small state machine of triage roles.

## gxpm-triage

Two **category** roles:
- `bug` — something is broken
- `enhancement` — new feature or improvement

Five **state** roles:
- `needs-triage` — maintainer needs to evaluate
- `needs-info` — waiting on reporter for more information
- `ready-for-agent` — fully specified, ready for an AFK agent
- `ready-for-human` — needs human implementation
- `wontfix` — will not be actioned

Every triaged issue should carry exactly one category role and one state role.

## Process

### 1. Show what needs attention

Query the issue tracker and present three buckets, oldest first:

1. **Unlabeled** — never triaged.
2. **`needs-triage`** — evaluation in progress.
3. **`needs-info` with reporter activity since last triage notes** — needs re-evaluation.

Show counts and a one-line summary per issue.

### 2. Triage a specific issue

1. **Gather context.** Read the full issue (body, comments, labels, reporter, dates). Parse prior triage notes. Explore the codebase. Read `.gxpm/out-of-scope/` (if exists) and surface any prior rejection that resembles this issue.

2. **Recommend.** Tell the maintainer your category and state recommendation with reasoning, plus a brief codebase summary.

3. **Reproduce (bugs only).** Before grilling, attempt reproduction. Report what happened — successful repro, failed repro, or insufficient detail (a strong `needs-info` signal).

4. **Grill (if needed).** If the issue needs fleshing out, run `/grill`.

5. **Apply the outcome:**
   - `ready-for-agent` — write an agent brief.
   - `ready-for-human` — same structure as agent brief, but note why it can't be delegated.
   - `needs-info` — post triage notes.
   - `wontfix` (bug) — polite explanation, then close.
   - `wontfix` (enhancement) — write to `.gxpm/out-of-scope/`, link from comment, then close.

### Agent brief format

```markdown
## What to build
Concise description.

## Acceptance criteria
- [ ] Criterion 1
- [ ] Criterion 2

## Key constraints
- Constraint 1
- Constraint 2

## Relevant code areas
- File/path 1
- File/path 2
```

### Needs-info template

```markdown
## Triage Notes

**What we've established so far:**
- point 1
- point 2

**What we still need from you (@reporter):**
- question 1
- question 2
```

## gxpm integration

- gxpm's `triage` phase initializes the `acceptance-contract` artifact.
- During triage, if the issue is a bug, the `acceptance-contract` must include a `reproduction` field:
  - Test command that reproduces the bug, OR
  - Steps to reproduce, OR
  - "Could not reproduce — insufficient detail"
- The `acceptance-contract` should include a `triageRole` field:
  - `needs-info` / `ready-for-agent` / `ready-for-human` / `wontfix`
- Use `gxpm issue create --auto-id` for new issues; use `gxpm issue transition` to move through phases.
- Out-of-scope knowledge lives under `.gxpm/out-of-scope/<topic>.md`.
