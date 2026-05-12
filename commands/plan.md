---
description: 任务拓扑与执行计划门 — 映射 gxpm plan → dispatch
---

# Command: /plan

## 对应 gxpm Phase
`plan` → `dispatch`

## 读取文档
1. `CANON.md` — 全局纪律
2. `.gxpm/issues/<id>/artifacts/acceptance-contract.json` — 已批准的规格
3. `skills/gxpm-planning/SKILL.md` — 规划方法论
4. `docs/governance/development-contract.md` — 开发与提交规范

## 调用 Skill
- `gxpm-planning` — 任务分解与拓扑排序
- `gxpm-tdd` — 测试策略（如适用）
- `gxpm-grill` — 计划压力测试（可选）

## 产出 Artifact
- `implementation-plan` — 更新后的详细执行计划
- `dispatch-handoff` — 工作项、依赖、风险、验证计划
- （大型/并行任务）`plans/*.md` — 子计划

## 通过条件
- [ ] `implementation-plan` 存在且 `status=ready`
- [ ] `dispatch-handoff` 已写入
- [ ] 如有 3+ 来源不明文件，`worktreeDecision` 已确认
- [ ] `gxpm issue transition <id> dispatch`

## 注意事项
- 只有 `Parallel Execution Matrix` 证明 `parallel_safe` 时才允许并行
- 不确定下一步时查 `gxpm issue next <id>`
