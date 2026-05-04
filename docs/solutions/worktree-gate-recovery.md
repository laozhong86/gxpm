---
title: "Worktree Gate 触发后的恢复步骤"
category: "recovery"
date: "2026-05-04"
severity: "medium"
component: "gxpm-cli"
tags: ["git", "worktree", "hook", "gate"]
---

# Worktree Gate 触发后的恢复步骤

## 场景

在 canonical main checkout 上尝试创建 feature branch 时，gxpm 的 pre-checkout hook 阻止操作并提示：

```
[gxpm gate branch-policy] main-worktree-non-main: canonical main checkout must stay on main
```

## 症状

- `git checkout -b feature-branch` 失败
- 错误信息要求使用 dedicated git worktree

## 解决步骤

1. **切回 main 分支**
   ```bash
   git checkout main
   ```

2. **删除已创建的 feature branch（如有）**
   ```bash
   git branch -D feature-branch
   ```

3. **创建 git worktree**
   ```bash
   git worktree add /path/to/worktrees/feature-branch-name -b feature-branch-name
   ```

4. **进入 worktree 目录开始工作**
   ```bash
   cd /path/to/worktrees/feature-branch-name
   ```

5. **如需临时绕过 gate**
   ```bash
   GXPM_GATE_DISABLE=1 git checkout -b feature-branch
   ```
   > 仅用于紧急修复，不推荐常规使用。

## 预防措施

- 进入 implement 阶段前，先检查 `git status -sb`
- 3+ 个来源不明文件时，默认走独立 worktree
- 牢记：`git worktree add` 之后必须 `cd` 进新 worktree 才能动代码

## 相关

- `docs/governance/development-contract.md`
- `hosts/claude.ts` — worktree enforcement 逻辑
