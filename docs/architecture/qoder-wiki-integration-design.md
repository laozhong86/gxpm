# Qoder Repo Wiki 集成到 GXPM Issue 流程设计方案

> 日期：2026-04-27
> 类型：架构设计 / Capability 集成
> 状态：草案待审

## 1. 设计目标

将 Qoder 生成的 **Repo Wiki（代码知识库）** 从「被动读取的导航辅助」升级为 GXPM **Capability Runtime 中的一等能力**，使其深度嵌入 issue 交付流程的每个关键节点。

**不是**重新发明一套 wiki 生成技术，**而是**在 GXPM 中集成、调度、消费 Qoder 已经生成的 `.qoder/repowiki/`。

---

## 2. 现状分析

### 2.1 已有能力（浅层集成）

| 组件 | 现状 | 局限 |
|------|------|------|
| `core/qoder.ts` | `ensureQoderWikiLink()` 管理 `.qoder/repowiki -> .gxpm/local/qoder/repowiki` symlink | 只负责目录链接，不感知内容 |
| `core/wiki.ts` | `getQoderWikiStatus()` 读取 Wiki 状态、top pages、stale 检测 | 只读，不驱动更新；stale 只基于时间，不基于代码变更 |
| CLI `gxpm wiki` | `status / mark-sync / mark-reminder` | 纯手动标记，无自动化 |
| CLI `gxpm qoder link` | symlink 管理 | 一次性操作 |
| SKILL.md | "先读 issue state，再读 wiki" | 文本提示，无结构化集成 |

### 2.2 Qoder Wiki 在 GXPM 中的实际落盘

```
.gxpm/local/qoder/repowiki/
└── zh/
    ├── content/
    │   ├── 项目概述.md
    │   ├── 架构文档.md
    │   ├── 核心概念/
    │   ├── 阶段和门禁系统/
    │   ├── CLI 命令参考/
    │   └── ...
    └── meta/repowiki-metadata.json
```

Qoder 已经完整生成了 GXPM 项目的代码知识库，内容质量高、结构完整。

---

## 3. 核心设计：Wiki Capability

将 Wiki 作为 GXPM Capability Runtime 的**独立 capability**，命名为 `wiki`。

```
Capability Runtime 新增：
- issue        (已有)
- planning     (已有)
- execution    (已有)
- verification (已有)
- review       (已有)
- browser      (已有)
- release      (已有)
- memory       (已有)
- skill        (已有)
+ wiki         (新增)  <-- 本设计目标
```

### 3.1 Wiki Capability 的合同

| 维度 | 定义 |
|------|------|
| **Input** | issueId（可选）、phase（可选）、query（可选） |
| **Output** | 相关 Wiki 页面列表、引用文件、上下文摘要 |
| **Mutation** | 标记 stale、触发重新生成请求、记录 sync 证据 |
| **Idempotency** | status 查询幂等；regenerate 非幂等但可重试 |
| **Failure** | Wiki 缺失时降级为直接源码读取，不阻塞 issue 流程 |

---

## 4. Issue 流程中的 Wiki 集成点

### 4.1 Phase 级集成矩阵

| Phase | Wiki 动作 | 触发时机 | 自动化级别 |
|-------|-----------|----------|-----------|
| **triage** | 读取「项目概述」「架构文档」注入上下文 | issue 创建后首次查询 | 自动（Agent 侧） |
| **plan** | 读取「核心概念」「阶段和门禁系统」辅助方案制定 | plan 阶段初始化时 | 自动（Agent 侧） |
| **dispatch** | 读取「产物管理系统」理解 artifact 规范 | dispatch-handoff 生成前 | 自动（Agent 侧） |
| **implement** | 读取「CLI 命令参考」辅助编码；检查 Wiki stale | 进入 implement 时 | 自动检测 stale |
| **local-verify** | 对比 Wiki 架构文档验证实现一致性 | local-verify artifact 生成时 | 建议性 |
| **self-review** | 检查代码变更是否影响 Wiki 引用文件 | self-review 阶段 | 自动检测 |
| **ship** | 无（聚焦 PR） | — | — |
| **land** | **触发 Wiki 重新生成** | post-merge hook | 自动触发 |

### 4.2 关键自动化机制

#### A. Implement 入口 Wiki Stale 检测

当前：只在 `gxpm wiki status` 中基于时间检测 stale。

改进：在 `transitionIssuePhase(..., "implement")` 时，自动检查代码变更是否涉及 Wiki 引用的文件。

```typescript
// core/state.ts 的 transitionIssuePhase 中
if (nextPhase === "implement") {
  const wikiStale = evaluateWikiStale({ root, issueId });
  if (wikiStale.affectedPages.length > 0) {
    // 写入 events.jsonl，不阻塞 transition
    appendIssueEvent({
      issueDir: paths.issueDir,
      event: {
        schemaVersion: 1,
        type: "wiki.stale_detected",
        issueId,
        timestamp: now,
        payload: {
          affectedPages: wikiStale.affectedPages,
          reason: "code changes overlap with wiki cited files",
        },
      },
    });
  }
}
```

#### B. Self-Review 代码-Wiki 一致性检查

在 `self-review` artifact 生成时，自动对比本次代码变更与 Wiki 文档：

- 提取 Git diff 中修改的文件列表
- 对比 Wiki `cite` 块中引用的文件
- 如果有重叠，在 self-review artifact 中附加 "Wiki Impact" 章节
- 建议："代码变更涉及 Wiki 引用文件，建议在 land 后重新生成 Wiki"

#### C. Land 后自动触发 Wiki Regenerate

在 `post-merge hook`（或 `transitionIssuePhase(..., "land")`）中：

```typescript
// core/land.ts 或 post-merge hook
if (nextPhase === "land") {
  const shouldRegen = evaluateWikiRegenNeed({ root, issueId });
  if (shouldRegen.need) {
    // 1. 记录事件
    appendIssueEvent({ ... type: "wiki.regen_triggered" ... });
    // 2. 调用 Qoder CLI 或标记待处理
    queueWikiRegeneration({ root, issueId, reason: shouldRegen.reason });
  }
}
```

**实现策略**：
- 如果环境中有 Qoder CLI（`qoder wiki regenerate`），直接调用
- 如果没有 Qoder CLI，写入 `.gxpm/wiki/regeneration-queue.json`，供后续批量处理

#### D. Git Diff 驱动的 Stale 检测（替代纯时间检测）

当前 `core/wiki.ts` 的 stale 逻辑：
```typescript
const syncOlderThanWeek = isOlderThanWeek(lastSyncAt, now);
const wikiUpdatedAfterSync = isAfter(observedWikiUpdatedAt, lastSyncAt);
```

改进：增加 **Git diff 重叠检测**：

```typescript
interface WikiStaleEvaluation {
  timeStale: boolean;        // 超过 7 天未 sync
  gitStale: boolean;         // Git diff 涉及 Wiki 引用文件
  affectedPages: string[];   // 具体受影响的 Wiki 页面
  reason: string;
}

function evaluateWikiStale(input: { root?: string; issueId?: string }): WikiStaleEvaluation {
  // 1. 时间检测（已有）
  // 2. Git diff 检测（新增）
  //    - 获取 issue 关联的 branch 与 base 的 diff
  //    - 提取 diff 中的文件列表
  //    - 对比 Wiki pages 的 citedFiles
  //    - 返回重叠的 pages
}
```

---

## 5. CLI 扩展

在现有 `gxpm wiki` 和 `gxpm qoder` 基础上扩展：

```bash
# === 现有命令（保持不变）===
gxpm wiki status [--json]
gxpm wiki mark-sync [--note <text>]
gxpm wiki mark-reminder [--note <text>]
gxpm qoder link [--target <path>] [--replace]

# === 新增命令 ===

# 为特定 issue 提取最相关的 Wiki 上下文
gxpm wiki context <issue-id> [--phase <phase>] [--json]
# 输出：该 issue 当前 phase 最应读取的 Wiki 页面列表

# 评估 Wiki 是否需要重新生成（Git diff 驱动）
gxpm wiki evaluate-stale [--issue <issue-id>] [--json]
# 输出：timeStale / gitStale / affectedPages

# 触发 Wiki 重新生成（调用 Qoder CLI 或加入队列）
gxpm wiki regenerate [--issue <issue-id>] [--reason <text>]
# 输出：regeneration 任务状态

# 查看 regeneration 队列
gxpm wiki queue [--json]
# 输出：待处理的 Wiki regeneration 任务列表

# 将 Wiki 上下文注入 issue 的 resume packet
#（用于新会话恢复时自动加载 Wiki 上下文）
gxpm wiki inject <issue-id> [--phase <phase>]
```

---

## 6. 数据模型扩展

### 6.1 `.gxpm/wiki/qoder.json` 扩展

当前：
```json
{
  "schemaVersion": 1,
  "provider": "qoder",
  "repoWikiRoot": ".qoder/repowiki",
  "lastSyncAt": "...",
  "lastReminderAt": "...",
  "note": "..."
}
```

扩展为：
```json
{
  "schemaVersion": 2,
  "provider": "qoder",
  "repoWikiRoot": ".qoder/repowiki",
  "lastSyncAt": "...",
  "lastReminderAt": "...",
  "note": "...",
  "regenerationQueue": [
    {
      "issueId": "GXPM-22",
      "triggeredAt": "2026-04-27T10:00:00Z",
      "reason": "landed; diff overlaps wiki cited files",
      "status": "pending"
    }
  ],
  "gitStaleCheck": {
    "lastCommitChecked": "abc123",
    "affectedPagesAtCheck": ["CLI 命令参考/基础命令.md"]
  }
}
```

### 6.2 Issue Event 类型扩展

在 `core/state.ts` 的 `StateEvent` 中新增 Wiki 相关事件：

```typescript
type StateEventType =
  | "issue.created"
  | "phase.transitioned"
  | "artifact.written"
  | "checkpoint.written"
  | "gate.blocked"
  | "gate.passed"
  // 新增：
  | "wiki.stale_detected"      // 检测到 Wiki 与代码不一致
  | "wiki.regen_triggered"     // 触发重新生成
  | "wiki.regen_completed"     // 重新生成完成
  | "wiki.context_injected";   // Wiki 上下文注入 issue
```

### 6.3 Resume Packet 扩展

在 `core/checkpoint.ts` 的 `ResumePacket` 中增加 Wiki 上下文：

```typescript
interface ResumePacket {
  // ... 现有字段 ...
  wikiContext?: {
    relevantPages: Array<{
      path: string;
      title: string;
      citedFiles: string[];
    }>;
    staleWarning?: string;
    lastSyncAt?: string;
  };
}
```

这样，新会话执行 `gxpm issue resume <id>` 时，自动获得该 issue 最相关的 Wiki 页面推荐。

---

## 7. Skill 模板更新

更新 `skills/gxpm/SKILL.md.tmpl`，将 Wiki 从「可选导航辅助」升级为「结构化上下文来源」：

**当前模板**：
```markdown
When a repo has `.qoder/repowiki`, treat it as an optional navigation aid
before direct source-code reads.
```

**更新后模板**：
```markdown
## Wiki Capability（Qoder Repo Wiki 集成）

GXPM 将 Qoder Repo Wiki 作为一等 capability。在 issue 流程中：

1. **Triage/Plan 阶段**：执行 `gxpm wiki context <issue-id>` 获取项目架构和核心概念上下文
2. **Implement 阶段**：执行 `gxpm wiki evaluate-stale` 检查代码变更是否影响 Wiki
   - 如果 stale：先更新 Wiki（`gxpm wiki regenerate`）再继续，或在实现中注意文档一致性
3. **Self-Review 阶段**：检查代码-Wiki 一致性；如不一致，在 self-review artifact 中记录
4. **Land 后**：GXPM 自动检测是否需要重新生成 Wiki，必要时加入队列

Wiki 不是可选的——它是项目架构真相源之一。优先读取 Wiki，再深入源码。
```

---

## 8. 核心模块改动清单

### 8.1 扩展 `core/wiki.ts`

新增函数：
- `evaluateWikiStale(input)` - Git diff 驱动的 stale 评估
- `getWikiContextForIssue(input)` - 为 issue 提取相关 Wiki 页面
- `queueWikiRegeneration(input)` - 加入重新生成队列
- `readRegenerationQueue(input)` - 读取队列

### 8.2 扩展 `core/state.ts`

在 `transitionIssuePhase` 中插入 Wiki hooks：
- implement 入口：stale 检测
- land 入口：regen 触发

扩展 `StateEvent` 类型。

### 8.3 扩展 `core/checkpoint.ts`

在 `writeIssueCheckpoint` / `readResumePacket` 中支持 `wikiContext` 字段。

### 8.4 扩展 `scripts/gxpm.ts`

新增 CLI 路由：
- `gxpm wiki context <issue-id>`
- `gxpm wiki evaluate-stale`
- `gxpm wiki regenerate`
- `gxpm wiki queue`

### 8.5 更新 `skills/gxpm/SKILL.md.tmpl`

将 Wiki capability 纳入 skill 指导文本。

---

## 9. 与 Qoder 的边界

| 职责 | Qoder（外部工具） | GXPM（本设计） |
|------|-------------------|----------------|
| **Wiki 生成** | Qoder 多 Agent 生成 `.qoder/repowiki/` | 不重新发明；调用 Qoder CLI 或标记待处理 |
| **Wiki 存储** | `.qoder/repowiki/` | 通过 symlink 共享访问 |
| **Wiki 消费** | Qoder IDE 面板 | GXPM Agent 通过 `core/wiki.ts` 结构化消费 |
| ** stale 检测** | Qoder 内部检测 | GXPM 增加 Git diff 驱动检测 |
| **触发再生** | 用户手动在 Qoder IDE 中点击 | GXPM 在 land 后自动触发/入队 |
| **issue 关联** | 无 | GXPM 将 Wiki 与 issue 生命周期关联 |

---

## 10. 实施路径

### Phase A：Git Diff Stale 检测（1 天）
1. 扩展 `core/wiki.ts`：`evaluateWikiStale()` 实现 Git diff 与 citedFiles 重叠检测
2. CLI：`gxpm wiki evaluate-stale [--issue <id>]`
3. 更新 `.gxpm/wiki/qoder.json` schema 到 v2

### Phase B：Issue 流程 Wiki Hooks（1 天）
1. `core/state.ts`：implement 入口插入 stale 检测事件
2. `core/state.ts`：land 入口插入 regen 触发逻辑
3. `core/checkpoint.ts`：resume packet 增加 wikiContext

### Phase C：Wiki Context 提取（1 天）
1. `core/wiki.ts`：`getWikiContextForIssue()` 实现
2. CLI：`gxpm wiki context <issue-id>`
3. `scripts/gxpm.ts`：resume 命令自动注入 Wiki 上下文

### Phase D：Regeneration 队列（1 天）
1. `core/wiki.ts`：队列管理（queue / read / clear）
2. CLI：`gxpm wiki regenerate`、`gxpm wiki queue`
3. 更新 SKILL.md.tmpl

### Phase E：验证（1 天）
1. 端到端测试：创建 issue → implement → land → 验证 Wiki regen 队列
2. `bun test` 补充
3. `bun run check` 通过

---

## 11. 成功标准

- [ ] `gxpm wiki evaluate-stale` 能基于 Git diff 检测代码变更与 Wiki 引用文件的重叠
- [ ] issue 进入 implement 时，events.jsonl 自动记录 `wiki.stale_detected` 事件
- [ ] issue land 后，`.gxpm/wiki/qoder.json` 的 regenerationQueue 自动追加条目
- [ ] `gxpm wiki context <issue-id>` 返回该 issue 最相关的 Wiki 页面
- [ ] `gxpm issue resume <id>` 的 resume packet 包含 wikiContext
- [ ] SKILL.md 将 Wiki 从「可选辅助」升级为「结构化上下文来源"
- [ ] 不引入 Qoder CLI 运行时依赖；Qoder 缺失时优雅降级为手动标记
