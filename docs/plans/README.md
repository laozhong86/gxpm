# docs/plans/

实现计划与技术方案的存放目录。

## 命名规范

所有文件采用 `*-plan.md` 命名：

- `feature-name-plan.md` — 功能实现计划
- `migration-name-plan.md` — 迁移计划
- `experiment-name-plan.md` — 实验方案

## 内容约定

- 概述（Summary）
- 实施步骤（Steps），按优先级排序
- 风险评估（Risks）
- 验证方法（Validation）
- 回滚策略（Rollback Plan，如适用）

## 与 dispatch 阶段的关系

plans/ 中的文档由 plan 阶段产出，经 dispatch 阶段确认后进入 implement。
