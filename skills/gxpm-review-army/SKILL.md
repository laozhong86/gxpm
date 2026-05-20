---
name: gxpm-review-army
type: technique
description: Agent Army 并行审查模式的使用指南。在 self-review 和 ship 阶段通过多角色并行扇出提升审查质量。
status: stable
---

# gxpm-review-army

在 gxpm 的 `self-review` 和 `ship` 阶段使用 Agent Army 并行审查模式，替代单一 reviewer 视角，显著提升审查覆盖面和问题发现率。

## When to trigger（入口条件）

- issue 已进入 `self-review` 或 `ship` 阶段
- 需要比单一 reviewer 更全面的多维度审查
- 变更涉及安全敏感、性能敏感或可访问性相关代码

## 可操作流程

### 在 self-review 阶段启用 Review Army

```bash
gxpm self-review cleanup <issue-id> --army
```

这会同时创建：
- `self-review.json` — 原有单一 reviewer 的审查记录
- `review-report.json` — Review Army 的并行审查报告（初始为 draft，待各角色填充 findings）

### Review Army 角色构成

| 角色 | 职责 | 触发条件 |
|------|------|----------|
| **Spec Compliance Reviewer** | 验收标准符合性 | 所有变更 |
| **Code Quality Reviewer** | 代码质量与可维护性 | 所有变更 |
| **Security Reviewer** | 安全漏洞与敏感数据 | 涉及外部输入、权限、依赖的变更 |
| **Test Reviewer** | 测试覆盖与质量 | 所有变更 |
| **Accessibility Reviewer** | 可访问性 | 涉及 UI 的变更 |

### 在 ship 阶段启用 Ship Audit Army

```bash
gxpm ship pr-check <issue-id> --army
```

这会同时创建：
- `ship-readiness.json` — 原有 ship readiness 检查清单
- `ship-audit-report.json` — Ship Audit Army 的专项审计报告

### Ship Audit Army 角色构成

| 角色 | 职责 |
|------|------|
| **Security Auditor** | 发布前安全专项审计 |
| **Performance Auditor** | 发布前性能影响评估 |
| **Docs Auditor** | 文档同步性检查 |

### Review Report 格式

```json
{
  "army": "review-army",
  "phase": "self-review",
  "findings": [
    {
      "role": "security-reviewer",
      "severity": "blocking",
      "location": "core/auth.ts:42",
      "rationale": "外部输入直接进入文件路径拼接，存在路径遍历风险",
      "recommendation": "使用 path.resolve 并限制在允许目录内，或改用 UUID 映射"
    }
  ]
}
```

### Severity 分级

| 级别 | 含义 | 对 gate 的影响 |
|------|------|----------------|
| **blocking** | 必须修复后才能进入下一阶段 | 阻止 phase transition |
| **important** | 强烈建议修复，但可在后续迭代处理 | 不阻止，但需记录 |
| **suggestion** | 可选改进，供参考 | 不阻止 |

### 与单一 reviewer 的协同

- **无 `--army` 标志时**：完全保持原有单一 reviewer 流程，无任何变化
- **有 `--army` 标志时**：Army 审查与单一 reviewer 并行产出，review-report 作为额外输入
- 单一 reviewer 负责**综合判断**和**合并建议**，Army 角色提供**专业视角**

## Red Flags（红旗清单 / HARD-GATE）

- **Review Army 产出的 blocking finding 未解决就推进到 ship** → 必须 STOP，回到 self-review 修复
- **在 ship 阶段发现 security auditor 的 blocking 问题** → 必须 STOP，回退到 implement 修复后重新走 review
- **为赶时间跳过 Accessibility Reviewer** → 可访问性是法律责任，不可跳过
- **混淆 important 和 blocking 的优先级** → 只有 blocking 会阻止 gate，但 important 需在 ship notes 中说明计划

## Verification（验证清单 / 出口条件）

- [ ] `--army` 标志正确传递，review-report 或 ship-audit-report 已创建
- [ ] 每个 Army 角色的 findings 已填入报告
- [ ] blocking 问题数为 0 或已在 ship notes 中说明豁免理由
- [ ] 所有 finding 包含完整的 location、rationale、recommendation
- [ ] 单一 reviewer 的 self-review.json 仍正常产出（向后兼容）

## 常见说辞表

| 说辞 | 现实 | 正确做法 |
|------|------|----------|
| "Army 审查太慢，我直接用单一 reviewer" | 5 个角色并行执行，实际时间不比串行慢 | 使用 `--army`，让专业角色并行工作 |
| "这些 finding 都是 suggestion，不重要" | suggestion 累计反映设计问题 | 关注 suggestion 的模式，而非单个 |
| "Security Reviewer 太严格了" | 安全漏洞的修复成本随阶段指数增长 | 在 self-review 阶段解决，不要留到 ship |
| "Accessibility 可以后续补" | 可访问性缺陷在发布后再修复成本 10x | 在 implement 阶段就通过 Accessibility Reviewer 检查 |

## Read Next

- `agents/reviewer.md` — 单一 reviewer 的协同说明
- `core/agent-runtime.ts` — Agent Runtime 技术细节
- `docs/governance/gherkin-style.md` — behavior-spec 写作规范
