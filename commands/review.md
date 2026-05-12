---
description: 多角色质量审查门 — 映射 gxpm ac-check → self-review → ship
---

# Command: /review

## 对应 gxpm Phase
`ac-check` → `self-review` → `ship`

## 读取文档
1. `CANON.md` — 全局纪律
2. `.gxpm/issues/<id>/artifacts/acceptance-check.json` — AC 检查结果
3. `skills/gxpm-review-changes/SKILL.md` — 代码审查方法论
4. `skills/gxpm-hygiene/SKILL.md` — 提交卫生检查

## 调用 Skill
- `gxpm-review-changes` — 结构化代码审查
- `gxpm-hygiene` — 提交卫生与原子提交纪律
- `gxpm-verify` — 本地验证管道执行

## 产出 Artifact
- `self-review` — 审查结果（blocking / important / suggestion 分级）
- `ship-readiness` — 发布就绪检查

## 通过条件
- [ ] blocking 问题全部解决（不能靠口头承诺跳过）
- [ ] `bun test`、`bun run check`、`git diff --check` 通过
- [ ] `self-review` artifact 已写入
- [ ] `gxpm issue transition <id> ship`

## 注意事项
- blocking 回 `/build`；批准后进入发布
- 不把 generated `SKILL.md` 冲突用“接受某一边”解决
- 新增 host、skill、生成规则时同步补测试或检查入口
