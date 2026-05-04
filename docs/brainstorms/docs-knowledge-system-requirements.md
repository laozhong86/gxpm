# docs/ 结构化知识沉淀体系需求

## 问题陈述

当前 gxpm 的工程决策、最佳实践、故障恢复手册散落在 chat 记忆和零散 markdown 中，缺乏跨会话恢复能力。新会话无法从 `.gxpm/` 恢复完整的工程上下文，导致知识流失和重复决策。

## 参考来源

compound-engineering-plugin 的 `docs/` 分类模式：
- `docs/brainstorms/` — 需求文档
- `docs/plans/` — 实现计划
- `docs/solutions/` — 最佳实践与恢复手册（带 frontmatter）
- `docs/specs/` — 各 host 平台规范镜像

## 成功标准

1. docs/ 目录有清晰的分类约定和命名规范
2. 所有解决方案文档带结构化 frontmatter（title, category, date, severity, component, tags）
3. 新会话可通过读取 docs/solutions/ 恢复关键工程决策
4. docs/brainstorms/ 和 docs/plans/ 的命名规范化（*-requirements.md, *-plan.md）

## 非目标

- 重写现有文档内容
- 建立自动化文档生成流水线

## 初步估算

1-2 天
