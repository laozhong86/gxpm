---
name: gxpm-review-army
type: technique
description: Agent Army 并行审查模式：Stage 1 spec compliance gate 通过后，Stage 2 才并行扇出 code-quality / security / test / accessibility reviewers。仿 superpowers subagent-driven-development 双阶段模板。
status: stable
---

**Announce at start:** "I am using the gxpm-review-army skill to gate on spec compliance first, then fan out parallel quality reviewers — Stage 1 must pass before Stage 2 dispatches."

# gxpm-review-army

在 gxpm 的 `self-review` 和 `ship` 阶段使用 **两阶段 Agent Army**：
- **Stage 1（门控）**：单一 Spec Compliance Reviewer 先验 AC 是否被本次变更满足。
- **Stage 2（扇出）**：仅当 Stage 1 无 blocking finding 时才并行启动 quality / security / test / accessibility reviewers。

这一结构来自 superpowers `subagent-driven-development` 的 spec-compliance-then-code-quality 纪律：先把"做对了吗"答清楚，再花并发预算去问"做好了吗"。

## When to trigger（入口条件）

- issue 已进入 `self-review` 或 `ship` 阶段
- 需要比单一 reviewer 更全面的多维度审查
- 变更涉及安全敏感、性能敏感或可访问性相关代码

## 可操作流程

### 在 self-review 阶段启用 Review Army

```bash
gxpm self-review cleanup <issue-id> --army
```

会同时创建：
- `self-review.json` — 原有单一 reviewer 的审查记录（向后兼容路径不变）
- `review-report.json` — Review Army 双阶段报告（初始 status=draft，按 stage 填充）

### Stage 1 · Spec Compliance Reviewer（必经门控）

**唯一角色**：Spec Compliance Reviewer。

- **输入边界**：`.gxpm/issues/<id>/artifacts/acceptance-contract.json`、`behavior-spec.json`、`implementation-plan.json` + 本 issue 在 worktree 内的 git diff。
- **不可读路径**：`.git/objects`、其他 issue 的 artifacts、`node_modules`。
- **职责**：逐条 AC、逐个 scenario 比对实现；不评价代码风格 / 性能 / 安全（那是 Stage 2 的事）。
- **输出**：写入 `review-report.payload.stage1.findings`；每个 finding 含 `reviewer: "spec-compliance"`、`severity`、`location`、`rationale`、`recommendation`、`blocking: boolean`。

**Gate**：如果 Stage 1 含任意 `blocking: true` finding → **不启动 Stage 2**，agent 必须先修复并重跑 Stage 1。

### Stage 2 · Quality Fan-out（仅当 Stage 1 通过）

**并行角色**（最多 4 个，按 `--army` 标志携带的 hints 自动裁剪）：

| 角色 | 职责 | 触发条件 |
|------|------|----------|
| **Code Quality Reviewer** | 代码可读性、复杂度、重复实现、命名 | 所有变更 |
| **Security Reviewer** | 外部输入、权限边界、敏感数据、依赖漏洞 | 涉及网络/认证/依赖/文件读写 |
| **Test Reviewer** | 测试覆盖、行为而非实现、AC 与 spec 对应 | 所有变更 |
| **Accessibility Reviewer** | a11y、键盘、对比度、ARIA | 涉及 UI 的变更 |

**每个 reviewer 的输入边界**：
- 可读：本 issue worktree 的 git diff、关联源文件、`docs/governance/*.md`、`CONTEXT.md`、`CANON.md`。
- 不可读：其他 issue 的 artifacts、`.git/objects`、secrets、`node_modules`。

**汇合**：每个 reviewer 把 findings 追加到 `review-report.payload.stage2.findings`；schema 与 Stage 1 一致。

### 并发上限（critical）

- **同时运行的 Stage 2 reviewer 数 ≤ 6**（与 CLAUDE.md 第 4 节多代理并发规范一致；Stage 1 不计入因为只跑 1 个，Stage 1+Stage 2 串行）。
- 单个 reviewer 失败 / 超时 → 不影响其他 reviewer；在 report 的对应 `reviewer.error` 字段记录原因，并把整体 status 设为 `partial`。
- 超过 6 → 必须串行批次 fan-out，每批 ≤6；任意一批失败要先收敛再下一批。

### 在 ship 阶段启用 Ship Audit Army

```bash
gxpm ship pr-check <issue-id> --army
```

同样的双阶段结构，但 Stage 2 角色集换为：

| Stage 2 角色 | 职责 |
|--------------|------|
| **Security Auditor** | 发布前安全专项审计（漏洞历史 / dependency vuln） |
| **Performance Auditor** | 发布前性能影响评估（基准 / hot path） |
| **Docs Auditor** | 文档同步性检查（CHANGELOG / README / API docs） |

Ship 阶段 Stage 1 仍是 Spec Compliance Reviewer，但输入扩展为 `acceptance-check.json` + `local-verify.json` 全证据链。

### Review Report 格式

```json
{
  "army": "review-army",
  "phase": "self-review",
  "status": "passed | partial | blocked | draft",
  "stage1": {
    "status": "passed | blocked",
    "findings": [
      {
        "reviewer": "spec-compliance",
        "severity": "blocking | important | suggestion",
        "location": "core/auth.ts:42",
        "rationale": "AC-03 要求 ...",
        "recommendation": "...",
        "blocking": true
      }
    ]
  },
  "stage2": {
    "status": "passed | partial | skipped",
    "findings": [
      {
        "reviewer": "security",
        "severity": "blocking",
        "location": "core/auth.ts:42",
        "rationale": "外部输入直接进入文件路径拼接，存在路径遍历风险",
        "recommendation": "使用 path.resolve 并限制在允许目录内，或改用 UUID 映射",
        "blocking": true
      }
    ]
  }
}
```

### Severity 分级

| 级别 | 含义 | 对 gate 的影响 |
|------|------|----------------|
| **blocking** | 必须修复后才能进入下一阶段 | 阻止 phase transition |
| **important** | 强烈建议修复，但可在后续迭代处理 | 不阻止，但需在 ship notes 中说明 |
| **suggestion** | 可选改进，供参考 | 不阻止 |

### 与单一 reviewer 的协同（向后兼容）

- **无 `--army` 标志**：完全保持原有单一 reviewer 流程，无任何变化；本 skill 不主动 fan-out。
- **有 `--army` 标志**：双阶段 Army 与单一 reviewer 并行产出。单一 reviewer 负责**综合判断**和**合并建议**，Army 角色提供**专业视角**。

## Red Flags（红旗清单 / HARD-GATE）

- **Stage 1 含 blocking 时启动 Stage 2** → STOP，先修复 Stage 1。
- **超过 6 个 reviewer 并发** → STOP，分批 fan-out。
- **Stage 2 reviewer 跨越输入边界**（读其他 issue 或 secrets）→ STOP，回到 reviewer 限定的可读路径列表。
- **为赶时间跳过 Stage 1 直接走 Stage 2** → STOP，spec compliance 是契约校验，跳过等于把 implement 阶段的错误带到 ship。
- **混淆 important 和 blocking 的优先级** → 只有 blocking 阻止 gate；important 必须写入 ship notes 中的计划。

## Verification（验证清单 / 出口条件）

- [ ] Stage 1 status 已写入 review-report，且无 blocking 时才推进 Stage 2
- [ ] Stage 2 fan-out 实际并发 ≤6（超过则分批）
- [ ] 每个 Army 角色的 findings 已填入对应 stage（`reviewer` 字段标识来源）
- [ ] blocking finding 数为 0 或已在 ship notes 中说明豁免理由
- [ ] 所有 finding 含完整 `location` / `rationale` / `recommendation` / `blocking`
- [ ] 单一 reviewer 的 `self-review.json` 仍正常产出（向后兼容）

## 常见说辞表

| 说辞 | 现实 | 正确做法 |
|------|------|----------|
| "Army 审查太慢，我直接用单一 reviewer" | Stage 2 并行执行，实际墙时间 ≈ 单一 reviewer 一倍 | 使用 `--army`，让 Stage 2 并行 |
| "Stage 1 也并行不就更快" | Stage 1 是 gate，并行 Stage 1+Stage 2 会让 blocking finding 之后的 Stage 2 工作浪费 | 严格串行 Stage 1 → Stage 2 |
| "Accessibility 可以后续补" | 可访问性缺陷在发布后再修复成本 10x | 在 implement 阶段就通过 Accessibility Reviewer 检查 |
| "Security Reviewer 太严格了" | 安全漏洞的修复成本随阶段指数增长 | 在 self-review 阶段解决，不要留到 ship |

## Read Next

- `agents/reviewer.md` — 单一 reviewer 的协同说明
- `core/agent-runtime.ts` — Agent Runtime 技术细节
- `docs/governance/gherkin-style.md` — behavior-spec 写作规范

## Terminal State

完成 review-army 双阶段后：

1. 把 `review-report.payload.status` 设为 `passed` / `partial` / `blocked`。
2. `gxpm artifact write <id> review-report --from <file>` 落盘。
3. 处理完所有 blocking finding 后，回到对应阶段的 main skill（`gxpm-review-changes` for self-review；`gxpm-verify` for pr-check / verify）继续推进。
