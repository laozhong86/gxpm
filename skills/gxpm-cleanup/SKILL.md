---
name: gxpm-cleanup
type: technique
description: 多 issue worktree 合并前的代码清理与简化。在 cleanup 阶段识别跨 issue 重复、命名不一致、接口错位和死代码。
status: stable
---

# gxpm-cleanup

在 gxpm 的 `cleanup` 阶段对多 issue worktree 进行跨 issue 代码清理，确保进入 `ship` 前的代码是统一、简洁、无重复的。

## When to trigger（入口条件）

- issue 已进入 `cleanup` 阶段
- worktree 中处理了 2+ 个 issue（单 issue 可跳过 cleanup）
- 所有 issue 已完成 `self-review`

## 可操作流程

### 在 cleanup 阶段初始化报告

```bash
gxpm self-review cleanup <issue-id>
```

这会创建 `cleanup-report.json` artifact，包含：
- `duplicatesExtracted` — 重复代码提取记录
- `renamesUnified` — 命名统一记录
- `interfacesAligned` — 接口对齐记录
- `deadCodeRemoved` — 死代码删除记录
- `testsDeduplicated` — 测试去重记录

### 跳过 cleanup（单 issue worktree）

```bash
gxpm issue transition <issue-id> ship --skip-cleanup
```

单 issue worktree 可直接从 self-review 进入 ship，跳过 cleanup 阶段。

**与 rigorLevel 的关系**：gxpm 的 `standard` 和 `lite` rigor 模式已自动跳过 cleanup 阶段（通过 `isCompressedSkip`），无需手动 `--skip-cleanup`。仅在 `full` 模式下需要显式跳过时才使用此 flag。

### Cleanup 检查清单

- [ ] 扫描 worktree 中所有 issue 的代码变更
- [ ] 识别功能重复的模块/函数
- [ ] 检查同一概念在不同 issue 中的命名一致性
- [ ] 验证 issue 之间的接口格式是否对齐
- [ ] 识别被后续 issue 替代的死代码
- [ ] 检查测试覆盖是否有冗余
- [ ] 记录所有发现到 cleanup-report

## Red Flags（红旗清单 / HARD-GATE）

- **发现功能完全重复的模块但未提取** → 必须 STOP，提取到共享位置
- **跨 issue 接口不兼容且无迁移方案** → 必须 STOP，对齐接口后再推进
- **死代码占比过高** → Important，需在 cleanup-report 中说明清理计划

## Verification（验证清单 / 出口条件）

- [ ] cleanup-report.json 已创建并包含审计结果
- [ ] 所有 blocking 级别问题已解决或获得豁免
- [ ] 重复代码已提取或计划在后续迭代处理
- [ ] 跨 issue 命名已统一或有明确的统一计划

## 常见说辞表

| 说辞 | 现实 | 正确做法 |
|------|------|----------|
| "这些重复是不同 issue 的职责，不应该提取" | 同一 worktree 的代码最终合并到同一 branch，重复就是债务 | 提取到共享位置，或明确说明为什么必须保持重复 |
| "接口不对齐是设计决策，不是 bug" | 设计决策需要在代码层面有文档和兼容层 | 在 cleanup-report 中记录决策，必要时添加适配层 |
| "cleanup 太费时间，直接 ship" | 跳过 cleanup 会让技术债务进入生产环境 | 至少记录发现的债务，在 ship notes 中说明还款计划 |

## Read Next

- `/gxpm-cleanup-auditor` — 审计角色详细定义
- `/gxpm-refactor-safely` — 安全重构指南
