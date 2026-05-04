# docs/ 结构化知识沉淀体系实现计划

## 概述

在 docs/ 下建立四个结构化子目录（brainstorms、plans、solutions、specs），定义分类约定、命名规范和 frontmatter 标准，并填充初始示例文档。

## 实施步骤

1. 创建 `docs/brainstorms/` 目录，添加 README.md 说明需求文档分类约定
2. 创建 `docs/plans/` 目录，添加 README.md 说明实现计划分类约定
3. 创建 `docs/solutions/` 目录，添加 README.md 说明最佳实践与恢复手册分类约定，定义 frontmatter 模板
4. 创建 `docs/specs/` 目录，添加 README.md 说明 host 平台规范镜像分类约定
5. 迁移现有 docs/ 子目录内容到对应分类，或在根目录保留并建立索引
6. 在 `docs/brainstorms/` 创建至少 1 份 `*-requirements.md` 示例
7. 在 `docs/plans/` 创建至少 1 份 `*-plan.md` 示例
8. 在 `docs/solutions/` 创建至少 3 份最佳实践/故障恢复手册（含完整 frontmatter）
9. 在 `docs/specs/` 创建 claude.md、codex.md、cursor.md 三份 host 规范镜像
10. 更新 docs/ 根目录 README.md 说明整体结构和导航
11. 运行 `bun run check` 验证无破坏

## 风险评估

- 现有 docs/ 子目录可能与新的分类体系冲突，需要明确是迁移还是并行保留
- frontmatter 标准过于严格可能导致后续维护负担
- docs/specs/ 的 host 规范镜像需要与 hosts/ 代码目录保持同步，存在漂移风险

## 验证方法

- 目录结构符合 acceptance-contract 7 条标准
- 所有 solutions/ 文档通过 frontmatter 完整性检查
- `bun run check` 通过
