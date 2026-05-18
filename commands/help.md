---
description: 能力发现入口 — 列出可用命令与技能
---

# Command: /help

## Goal
帮助用户和 Agent 发现 gxpm 当前可用的命令、技能和文档入口。

## 读取文档
1. `CANON.md` — 全局纪律
2. `AGENTS.md` — 项目约束入口
3. `skills/gxpm/SKILL.md` — 核心 skill 索引
4. `skills-index.json` — 技能发现索引（如存在）

## 输出

### 核心命令
| 命令 | 对应 gxpm Phase | 作用 |
|------|----------------|------|
| `/refine` | triage → plan | 需求收敛与事实扫描 |
| `/plan` | plan → dispatch | 任务拓扑与执行计划 |
| `/build` | dispatch → implement | 增量实现与决策记录 |
| `/review` | ac-check → self-review → ship | 多角色质量审查 |
| `/ship` | ship → land | 发布、导出与文档同步 |

### 常用 CLI
```bash
gxpm issue create --auto-id [--type meta]
gxpm issue status <id>
gxpm issue next <id>
gxpm issue transition <id> <phase>
gxpm phase rewind <id> --to <phase> --reason "..."
gxpm artifact write <id> <type> --json '...'
bun test
bun run check
bun run gen:skill-docs
```

### 核心 Skill
- `gxpm-triage` — 分类与范围收敛
- `gxpm-planning` — 任务拓扑与计划
- `gxpm-implementer` — 增量实现与自审
- `gxpm-review-changes` — 代码审查
- `gxpm-verify` — 验证管道
- `gxpm-debug-issue` — 调试
- `gxpm-refactor-safely` — 安全重构

### 渐进文档
- 全局纪律 → `CANON.md`
- 开发规范 → `docs/governance/development-contract.md`
- Skill 写法 → `docs/governance/template-authoring.md`
- 架构 → `docs/architecture/`
