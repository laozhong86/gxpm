---
description: 增量实现与决策记录入口 — 映射 gxpm dispatch → implement → local-verify
---

# Command: /build

## 对应 gxpm Phase
`dispatch` → `implement` → `local-verify` → `ac-check`

## 读取文档
1. `CANON.md` — 全局纪律
2. `.gxpm/issues/<id>/artifacts/dispatch-handoff.json` — 派发交接单
3. `skills/gxpm-implementer/SKILL.md` — 实现者行为模板
4. `skills/gxpm-tdd/SKILL.md` — TDD 方法论（如适用）
5. `docs/governance/development-contract.md` — 开发规范

## 调用 Skill
- `gxpm-implementer` — 增量实现与四维自审
- `gxpm-tdd` — 红-绿-重构循环
- `gxpm-build` — 编译与类型检查
- `gxpm-debug-issue` — 调试（失败时）
- `gxpm-refactor-safely` — 安全重构（需要时）

## 产出 Artifact
- 代码变更（commit 到 feature branch）
- `local-verify` — 本地验证结果
- `acceptance-check` — AC 符合性检查
- （需要决策时）`adr/<num>.md` — 架构决策记录

## 通过条件
- [ ] 已 `cd` 进 worktree 再编辑
- [ ] `bun test` 通过（或记录基线失败证据）
- [ ] `bun run check` 通过
- [ ] `gxpm issue transition <id> local-verify`
- [ ] `gxpm issue transition <id> ac-check`

## 注意事项
- 每次 commit 只表达一个逻辑变化，message 必须含 `GXPM-N` 引用
- 进入 implement 前 `git status -sb` 检查未追踪文件
- 失败时进入 debug 回路，不硬推
