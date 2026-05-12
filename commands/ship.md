---
description: 发布、导出与文档同步门 — 映射 gxpm ship → pr-check → verify → qa → land
---

# Command: /ship

## 对应 gxpm Phase
`ship` → `pr-check` → `verify` → `qa` → `land`

## 读取文档
1. `CANON.md` — 全局纪律
2. `.gxpm/issues/<id>/artifacts/ship-readiness.json` — 发布就绪状态
3. `skills/gxpm-verify/SKILL.md` — 验证管道
4. `docs/governance/development-contract.md` — 提交与发布规范

## 调用 Skill
- `gxpm-verify` — 完整验证管道执行与证据收集
- `gxpm-hygiene` — 最终提交卫生检查

## 产出 Artifact
- `pr-check` — PR 就绪状态
- `verify-findings` — 验证结果
- `qa-findings` — QA 结果（含 `retainWorktreeReason` 如需保留）
- `land-findings` — 落地报告
- （可选）`06-canary-report.md`、`07-deploy-report.md`

## 通过条件
- [ ] PR 创建且 checks 通过
- [ ] `verify-findings` 已写入
- [ ] `qa-findings` 已写入
- [ ] merge 后 post-merge hook 自动 transition `qa → land`
- [ ] `land` 后默认运行 `gxpm cleanup land <id> --execute`

## 注意事项
- destructive cleanup、发布、合并、远端写操作前确认
- 若保留 worktree，必须在 `land-findings` 写 `retainWorktreeReason`
- 完成 land 后标记 Linear issue 为 Done
