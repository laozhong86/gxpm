---
name: gxpm-setup
description: Scaffold per-repo configuration for gxpm skills. Use when first using gxpm in a repo, or when issue tracker, triage labels, or domain doc layout is unclear.
---

# Setup

Scaffold the per-repo configuration that gxpm skills consume:

- **Issue tracker** — where issues live (GitHub, Linear, or local markdown)
- **Triage labels** — the strings used for the five canonical triage roles
- **Domain docs** — where `CONTEXT.md` and ADRs live, and the consumer rules for reading them

## 入口条件

**何时触发**
- 首次在当前 repo 使用 gxpm skills。
- `gxpm-triage`、`gxpm-planning` 等 skill 缺少 issue tracker 或 label 上下文。
- 用户说 "setup gxpm"、"configure gxpm"、"初始化 gxpm"。
- 刚创建新 repo，需要配置 gxpm 工作流。

**Skill 边界**
- 需要创建 issue → `/gxpm-triage`
- 需要写计划 → `/gxpm-planning`
- 需要调试 → `/gxpm-diagnose`

## 可操作流程

### 1. Explore

Read the current repo state:

- `git remote -v` — GitHub? GitLab? No remote?
- `AGENTS.md` / `CLAUDE.md` at root — does either exist?
- `CONTEXT.md` / `CONTEXT-MAP.md` at root
- `docs/adr/` or `.gxpm/out-of-scope/` directories
- Existing `.gxpm/config.json`

### 2. Present findings and ask

Summarise what's present and what's missing. Walk the user through three decisions **one at a time**.

**Section A — Issue tracker.**

Default: if `git remote` points at GitHub, propose GitHub Issues. Otherwise offer:

- **GitHub** — uses `gh` CLI
- **Linear** — uses Linear CLI
- **Local markdown** — issues as files under `.gxpm/issues/` (gxpm default)
- **Other** — ask user to describe the workflow in one paragraph

**Section B — Triage label vocabulary.**

The five canonical roles:

- `needs-triage` — maintainer needs to evaluate
- `needs-info` — waiting on reporter
- `ready-for-agent` — fully specified, AFK-ready
- `ready-for-human` — needs human implementation
- `wontfix` — will not be actioned

Default: each role's string equals its name. Ask if they want to override any.

**Section C — Domain docs.**

Confirm layout:

- **Single-context** — one `CONTEXT.md` + `docs/adr/` at repo root (most repos)
- **Multi-context** — `CONTEXT-MAP.md` at root pointing to per-context `CONTEXT.md` files (monorepo)

### 3. Write config

Write to `.gxpm/agents/`:

```
.gxpm/
├── agents/
│   ├── issue-tracker.md
│   ├── triage-labels.md
│   └── domain.md
```

Also update `AGENTS.md` or `CLAUDE.md` with an `## Agent skills` block if not present.

## 红旗清单 / 反模式

- **STOP：不要假设用户的 issue tracker。** 总是先检查 `git remote` 再提问。
- **STOP：不要覆盖用户已有的配置。** 如果 `.gxpm/agents/` 已存在，先展示当前内容，询问是否更新。
- **STOP：不要同时问三个问题。** 一次只问一个 section，得到回答后再继续。

## 验证清单 / 出口条件

- [ ] `.gxpm/agents/issue-tracker.md` 已写入，包含 tracker 类型和 CLI 工具。
- [ ] `.gxpm/agents/triage-labels.md` 已写入，包含 5 个 canonical roles 的映射。
- [ ] `.gxpm/agents/domain.md` 已写入，包含 CONTEXT.md / ADR 布局规则。
- [ ] `AGENTS.md` 或 `CLAUDE.md` 已更新 `## Agent skills` 区块（如果不存在）。
- [ ] 用户已确认配置正确。

**失败时路由**
- 配置后需要创建 issue → `/gxpm-triage`
- 配置后需要制定计划 → `/gxpm-planning`
