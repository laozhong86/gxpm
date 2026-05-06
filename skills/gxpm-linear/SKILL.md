---
name: gxpm-linear
description: Linear CLI integration for gxpm issue lifecycle. Use when creating, updating, or querying Linear issues via command line. Replaces unstable MCP with stable CLI.
status: stable
---
<!-- AUTO-GENERATED from SKILL.md.tmpl - do not edit directly -->

# gxpm-linear

Linear 协作前门，通过 CLI 与 issue tracker 交互。**不使用 MCP** — 所有操作走 `linear` 命令。

## When to trigger

- 需要创建/更新/查询 Linear issue
- gxpm issue 需要同步到 Linear（`maybeSyncIssue` 的替代路径）
- Sprint 规划、backlog 分类、批量操作
- 需要读取 issue 评论获取上下文

## Prerequisites

```bash
# CLI 已安装在
/opt/homebrew/bin/linear

# 如不在 PATH
export PATH="/opt/homebrew/bin:$PATH"
```

## Auth

```bash
linear auth login    # 首次使用或 token 过期
linear config        # 查看默认 team/workspace
```

> **认证收敛**：gxpm 内置 issue-sync 直接调用 `linear` CLI，**不再单独配置 API key**。
> 只需确保 `linear auth login` 已完成，gxpm 会自动复用其认证状态。
> 旧配置 `sync.linearApiKey` 和 `GXPM_LINEAR_API_KEY` 已废弃，可安全移除。

## Global flags

| Flag | 说明 |
|------|------|
| `--json` | 机器可读输出（默认使用） |
| `--text` | 人类可读输出 |
| `--dry-run` | 预览不执行 |
| `--team <KEY>` | 指定 team（如 `GXG`） |

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


## Workflows

### Full Context = View + Comments

`linear issue view` 只返回标题、描述、状态和元数据。**评论是独立 API 调用。**

**规则**：接手 issue 时必须同时运行：
```bash
linear issue view GXG-123 --json
linear issue comment list GXG-123 --json
```

评论中可能包含 scope 定义、设计决策、PoC 结果、review 反馈、跨 agent 交接上下文。仅在批量 list/triage 时可跳过评论阅读。

### Creating an Issue

1. 搜索重复：`linear issue list --team GXG --query "keyword" --all --sort priority --json`
2. 检测当前 git branch：`git branch --show-current`
3. 起草 issue（标题、描述、标签、项目、团队、负责人、优先级）
4. 呈现给用户确认
5. 执行：
   ```bash
   linear issue create \
     -t "[Domain] Clear description" \
     --team GXG \
     --priority 2 \
     --label feature --label backend \
     --json
   ```
6. 报告 issue identifier 和链接

### Implementing a Linear Issue

1. 获取完整上下文（view + comments）
2. 移到 Todo：`linear issue update GXG-123 --state "Todo" --json`
3. 读取 acceptance criteria 和依赖
4. 创建 feature branch（命名含 issue ID）
5. TDD 实现
6. 完成后移到 In Review：`linear issue update GXG-123 --state "In Review" --json`
7. 添加 completion comment：
   ```bash
   BRANCH=$(git branch --show-current)
   linear issue comment add GXG-123 --body "## Completion Summary
   **Branch:** \`$BRANCH\`
   **PR:** <pr-url-or-pending>
   **Summary:** <what was done>" --json
   ```

### Bulk Operations

3+ issue 的批量操作：
1. 收集所有目标 issue
2. 以表格呈现：Issue ID、Current State、Proposed Change、Reason
3. 加 `--dry-run` 预览
4. 等用户确认后执行
5. 报告摘要：N succeeded, N failed

### Sub-Issue Management

子 issue 继承父 issue：
- 相同 project 和 team
- 相同标签（除非有理由覆盖）
- 通过 parent 关系链接

```bash
# 创建子 issue
linear issue create -t "Sub-task title" --team GXG --parent GXG-123 --json
# 或给已有 issue 设置 parent
linear issue update GXG-456 --parent GXG-123 --json
```

### Sprint Planning

1. 收集当前状态：
   ```bash
   linear cycle current --json
   linear cycle next --json
   linear issue list --team GXG --state backlog --sort priority -A --json
   linear user list --json
   ```
2. 分析：按优先级排序（P0 bugs > blockers > high-value features > tech debt）
3. 以表格呈现计划：issue、priority、assignee、estimate、rationale
4. 确认后批量分配到 cycle

### Backlog Triage

1. 拉取未分类项：
   ```bash
   linear issue list --team GXG --state triage --sort priority -A --json
   linear issue list --team GXG --state backlog --sort priority -A --json
   ```
2. 对每个 issue 推荐：priority、labels、assignee、cycle placement
3. 以表格呈现 triage 计划
4. 确认后执行
5. 标记 stale issue（3+ cycles 无活动）— 先提醒用户 review

### Status Integrity

- 永远不要硬编码 state 名称，先查：
  ```bash
  linear workflow-state list --json
  ```
- 关父 issue 前先查子 issue：
  ```bash
  linear issue children GXG-123 --json
  ```
- 任何子 issue 未 Done 都不能关父 issue

### Label Taxonomy

应用标签前先确认存在：
```bash
linear label list --json
```

| Category | Labels | Rule |
|----------|--------|------|
| **Type** | `feature`, `bug`, `chore`, `tech-debt`, `spike` | 恰好一个 |
| **Domain** | `frontend`, `backend`, `infra`, `design`, `security`, `testing` | 1-2 个 |
| **Workflow** | `blocked`, `in-review`, `needs-design`, `needs-split` | 按需 |


## Core Principles

1. **Issue 是单一真相源** — 所有需求、bug、变更都先落地 Linear issue
2. **创建前先查重** — `linear issue list --query "keyword"` 避免重复
3. **写操作需确认** — 批量操作先呈现表格，等用户点头再执行
4. **状态完整性** — 子 issue 全 Done 才能关父 issue

## Tips

- `--json` 优先于 `--text`，方便脚本解析
- `issue list` 默认只显示分配给当前用户的，加 `-A` 看全部
- `issue list` 必须加 `--sort`（`manual` 或 `priority`）
- GraphQL escape hatch: `linear api '{ issues { nodes { id title } } }'`

## Read Next

- `docs/governance/development-contract.md`
- Main `/gxpm` skill for phase gate details
