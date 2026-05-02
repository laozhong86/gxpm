# Triage Label Vocabulary

> Maps canonical triage roles to actual label strings in the issue tracker.
> Edit when your issue tracker uses different label names.

## Canonical Roles

| Canonical role | Default label string | Meaning |
|----------------|---------------------|---------|
| `needs-triage` | `needs-triage` | Maintainer needs to evaluate |
| `needs-info` | `needs-info` | Waiting on reporter for more information |
| `ready-for-agent` | `ready-for-agent` | Fully specified, AFK-ready (agent can pick up with no human context) |
| `ready-for-human` | `ready-for-human` | Needs human implementation |
| `wontfix` | `wontfix` | Will not be actioned |

## Category Roles

| Canonical role | Default label string | Meaning |
|----------------|---------------------|---------|
| `bug` | `bug` | Something is broken |
| `enhancement` | `enhancement` | New feature or improvement |

## Usage

- Every triaged issue should carry exactly one category role and one state role.
- If state roles conflict, flag it and ask the maintainer before doing anything else.
- The maintainer can override at any time — flag transitions that look unusual and ask before proceeding.

## gxpm Integration

- The `acceptance-contract` artifact includes a `triageRole` field that maps to these canonical names.
- `gxpm issue list --type` filters by classification but does not alter phase gates.
