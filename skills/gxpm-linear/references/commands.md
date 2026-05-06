## CLI Commands

### Issue Commands

| Task | Command |
|------|---------|
| List my issues | `linear issue list --team GXG --sort priority --json` |
| List all issues | `linear issue list --team GXG --all --sort priority --json` |
| Filter by state | `linear issue list --team GXG --state todo --sort priority -A --json` |
| Filter by project | `linear issue list --team GXG --project "Name" --sort priority -A --json` |
| Search by text | `linear issue list --team GXG --query "keyword" --sort priority -A --json` |
| View issue | `linear issue view GXG-123 --json` |
| View with children | `linear issue children GXG-123 --json` |
| Create issue | `linear issue create -t "Title" --team GXG --priority 2 --label feature --json` |
| Create with parent | `linear issue create -t "Sub-task" --team GXG --parent GXG-123 --json` |
| Create with desc file | `cat desc.md \| linear issue create -t "Title" --team GXG --json` |
| Update state | `linear issue update GXG-123 --state "In Progress" --json` |
| Move (shorthand) | `linear issue move GXG-123 "In Progress"` |
| Update title | `linear issue update GXG-123 -t "New Title" --json` |
| Set priority | `linear issue priority GXG-123 2` |
| Assign | `linear issue assign GXG-123 self` |
| Set estimate | `linear issue estimate GXG-123 3` |
| Add comment | `linear issue comment add GXG-123 --body "text" --json` |
| Batch create | `linear issue create-batch --json < batch.json` |
| Dry-run preview | `linear issue create -t "Title" --team GXG --dry-run --json` |

### Comment Subcommands

| Task | Command |
|------|---------|
| Add comment | `linear issue comment add GXG-123 --body "text" --json` |
| List comments | `linear issue comment list GXG-123 --json` |
| Update comment | `linear issue comment update <commentId> --json` |
| Delete comment | `linear issue comment delete <commentId>` |

### Issue Relations

| Task | Command |
|------|---------|
| List relations | `linear issue relation list GXG-123 --json` |
| Add relation | `linear issue relation add GXG-123 --json` |
| Delete relation | `linear issue relation delete <relationId>` |

### Other Commands

| Task | Command |
|------|---------|
| List teams | `linear team list --json` |
| Team members | `linear user list --json` |
| Workflow states | `linear workflow-state list --json` |
| Labels | `linear label list --json` |
| Current cycle | `linear cycle current --json` |
| Next cycle | `linear cycle next --json` |
| List cycles | `linear cycle list --json` |
| List projects | `linear project list --json` |
| View project | `linear project view <slug> --json` |
| Create project | `linear project create --name "Name" --json` |
| List milestones | `linear milestone list --json` |
| List initiatives | `linear initiative list --json` |
| List documents | `linear document list --json` |
| List users | `linear user list --json` |
| Notifications | `linear notification list --json` |
| GraphQL escape hatch | `linear api '{ issues { nodes { id title } } }'` |

### Troubleshooting

| Problem | Fix |
|---------|-----|
| Auth failure | Re-run `linear auth login` |
| Rate limited | Batch operations, add delays |
| "No team configured" | Add `--team GXG` or run `linear config` |
| "Sort must be provided" | Add `--sort priority` to `issue list` |
| CLI not found | Use full path `/opt/homebrew/bin/linear` |
| Wrong workflow states | Query `linear workflow-state list --json` first |
