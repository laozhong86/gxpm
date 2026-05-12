## Workflows

### Full Context = View + Comments

`linear issue view` 只返回标题、描述、状态和元数据。**评论是独立 API 调用。**

**规则**：接手 issue 时必须运行：
```bash
linear issue view GXG-123 --json
```
Comments require a GraphQL query via `linear api` (CLI v3.2.0 removed `issue comment list`).

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
