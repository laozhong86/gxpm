---
description: 需求收敛与事实扫描入口 — 映射 gxpm triage → plan
---

# Command: /refine

## 对应 gxpm Phase
`triage` → `plan`

## 读取文档
1. `CANON.md` — 全局纪律
2. `CONTEXT.md` — 术语表
3. `docs/architecture/gxpm-v0-contract.md` — 阶段与产物定义
4. `skills/gxpm-triage/SKILL.md` — 分类方法论
5. `skills/gxpm-planning/SKILL.md` — 规划方法论

## 调用 Skill
- `gxpm-triage` — 范围收敛、需求澄清
- `gxpm-planning` — 任务拓扑与执行计划
- `gxpm-grill` — 压力测试计划（可选）

## 产出 Artifact
- `acceptance-contract` — 范围、成功标准、非目标
- `implementation-plan` — 步骤、验收标准、风险
- （可选）`01-spec.md` — 人类可读规格摘要

## 通过条件
- [ ] issue 已创建（`gxpm issue create --auto-id [--type meta]`）
- [ ] `acceptance-contract` 已写入
- [ ] `implementation-plan` 已写入且 `constitutionCheck` 通过
- [ ] `gxpm issue transition <id> plan`

## 注意事项
- 新的非平凡任务必须先走需求确认；用户说“直接做”时可跳过
- meta tracker、retro、长期观察日志必须用 `--type meta`
