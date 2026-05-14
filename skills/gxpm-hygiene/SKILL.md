---
name: gxpm-hygiene
description: Pre-commit hygiene and atomic commit discipline. Use before every commit, or when preparing changes for self-review or ship.
---

# gxpm-hygiene

## 入口条件

在以下场景触发本 skill：

- 每次提交前
- 准备变更进行自审（`self-review`）时
- 准备进入 `ship` 阶段、整理 PR 时

**Skill 边界**：本 skill 聚焦 **git 层纪律**（即将提交的内容本身），不验证代码是否可编译或通过测试。编译与测试验证是 `gxpm-build`（开发中）和 `gxpm-verify`（`local-verify` 关卡）的职责。在 hygiene 中重复运行那些检查会造成冗余循环并模糊责任边界。

在 gxpm 工作流中：
- `implement` 阶段每次提交前都运行本检查清单
- `self-review` 阶段必须确认所有提交都遵循了本纪律
- `ship` 阶段将本检查清单作为 PR 准备的一部分

## 可操作流程

按以下顺序执行预提交检查：

```bash
# 1. Review what you're about to commit
git diff --staged

# 2. Secret leak scan (manual review)
git diff --staged --name-only | xargs grep -l "\.env" 2>/dev/null || true
# Also review diff for high-entropy strings that look like keys/tokens

# 3. Confirm atomicity — one logical change
git diff --staged --stat
```

**为什么这里不运行 `bun run check` / `bun test` / `bun run build`？**
These are the responsibility of `gxpm-build` (during development) and `gxpm-verify` (at the `local-verify` gate). Running them in hygiene creates redundant cycles and blurs accountability.

### 原子提交规则

- **One logical change per commit.** Do not mix refactoring, features, and unrelated cleanups.
- **Generated files:** If `.tmpl` was modified, `bun run gen:skill-docs` must run first.
- **Issue reference:** Commit message must include `GXPM-N` reference.
- **Worktree discipline:** Main checkout stays on `main`. Feature work happens in dedicated worktrees.

## 红旗清单 / 反模式

- Committing with `--no-verify` to bypass checks
- Build or tests failing at commit time
- Missing `GXPM-N` reference in commit message
- One commit mixing refactor + feature + cleanup
- Uncommitted generated files after modifying templates
- Committing secrets or `.env` files
- Running the same check twice without code changes in between

## 验证清单 / 出口条件

提交前必须确认：

- [ ] 已审查 `git diff --staged` 中的全部变更
- [ ] 已扫描潜在密钥/令牌泄漏和高熵字符串
- [ ] 本次提交只包含一个逻辑变更（原子性）
- [ ] 如修改了 `.tmpl`，已重新生成关联文件
- [ ] Commit message 包含 `GXPM-N` 引用
- [ ] 未使用 `--no-verify` 绕过检查
- [ ] 未提交 `.env` 或密钥文件
