---
title: "新会话通过 docs/ 恢复工程上下文"
category: "practice"
date: "2026-05-04"
severity: "high"
component: "*"
tags: ["context", "session", "onboarding", "docs"]
---

# 新会话通过 docs/ 恢复工程上下文

## 场景

新 AI 会话启动时，chat 记忆为空，需要快速恢复项目的关键工程决策、约束和最佳实践。

## 推荐步骤

1. **读取架构概览**
   ```bash
   cat docs/architecture/gxpm-replacement-architecture.md
   cat docs/architecture/gxpm-v0-contract.md
   ```

2. **查阅治理契约**
   ```bash
   cat docs/governance/development-contract.md
   cat docs/governance/skill-authoring.md
   ```

3. **扫描解决方案库**
   ```bash
   ls docs/solutions/
   # 按需读取相关恢复手册
   ```

4. **确认 host 规范**
   ```bash
   cat docs/specs/$(detect_host).md
   ```

5. **检查当前 issue 状态**
   ```bash
   ./bin/gxpm issue list
   ./bin/gxpm issue next GXPM-N
   ```

## 优先级

| 优先级 | 文档 | 目的 |
|--------|------|------|
| P0 | `AGENTS.md` | 项目级代理契约 |
| P0 | `CONTEXT.md` | 共享语言/术语表 |
| P1 | `docs/governance/development-contract.md` | 开发流程与约束 |
| P1 | `docs/solutions/` | 工程决策与故障恢复 |
| P2 | `docs/specs/` | Host 平台适配要求 |
| P2 | `docs/architecture/` | 系统设计参考 |

## 维护责任

- 每次重大工程决策后，同步更新 `docs/solutions/`
- 每次 host 适配变更后，同步更新 `docs/specs/`
- 每月审查一次 `docs/` 目录，归档过时内容

## 相关

- `docs/governance/template-authoring.md`
- `docs/research/pmc-gstack-skill-study.md`
