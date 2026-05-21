# gxpm Agent Contract

## Role

gxpm 是面向完全替代 `pmc` 和 `gstack` 的第二代代理项目管理产品。PMC 和 gstack 是上游研究对象与能力来源，不是 gxpm 的长期运行依赖。

<!-- BEGIN USER-SPECIFIED -->
**核心定位：AI Agent 工作制度架构 + 工作流 + 状态机的可执行产品。**

形态：**基于文档驱动的制度套件 + CLI 运行时。**

gxpm 不是 PMC 的兼容壳，也不是 gstack 的插件集合。所有设计都要服务于独立产品闭环：统一 state graph、capability runtime、browser evidence、review/ship governance 和 agent execution loop。

**架构哲学 —— 四维分工：**

| 维度 | 职责 | gxpm 体现 |
|---|---|---|
| **commit** | 阶段切分 | git worktree 隔离 + phase transition，物理与逻辑双重边界 |
| **Agent** | 角色分工 | triage/plan/implement/review/QA/land owner，责任视角而非人格模板 |
| **skill** | 能力注入 | `skills/*/SKILL.md` 可发现、可加载、可校验的方法目录 |
| **证据/事实** | 持久存储 | `artifacts/*.json` + `evidence/` + `state.json`，本地文件系统为唯一真值 |

**五层架构：**

```
L1: 制度文档层 — CANON.md / AGENTS.md / CONTEXT.md / docs/governance/*.md
L2: 角色与技能层 — agents/*.md / skills/*/SKILL.md / templates/*.tmpl
L3: 工作流编排层 — workflows/*.yml / core/phase-gates.ts / PHASE_GATE_RULES
L4: 状态机执行层 — core/state.ts / core/capabilities.ts / CLI commands
L5: 证据与恢复层 — .gxpm/issues/<id>/{state,artifacts,evidence,memory}/
```

**核心原则：**

1. 文档即制度，制度可执行 —— 治理规则以文本存在，被 CLI 解析、被模板生成、被 hook 校验。
2. 本地 state 永远比外部系统更权威 —— `state.json` 比 Linear comment、PR body、聊天上下文更权威。
3. 所有 transition 都必须可审计、可重放、可恢复 —— 事件 append-only 写入 `events.jsonl`。
4. Command 只路由，Agent 只担责，Skill 只注入，Artifact 只存真值 —— 分层边界不可漂移。

**Phase 顺序（14 阶段，按 `rigorLevel` 压缩）：**

完整：`triage → plan → dispatch → specify → implement → local-verify → ac-check → self-review → cleanup → ship → pr-check → verify → qa → land`

- `lite`（spike/meta）：7 阶段，跳过 dispatch, local-verify, ac-check, cleanup, pr-check, verify, qa
- `standard`（默认）：9 阶段，跳过 local-verify, ac-check, cleanup, pr-check, verify
- `full`：14 阶段，不跳过

底层阶段不变，transition 允许跨阶段跳跃；跳过阶段仍记入 `phaseHistory` 保持审计链。

- **specify**：BDD 行为规约阶段。产出 `behavior-spec.json` artifact + 空测试 stub；必须由用户通过 `gxpm specify confirm <id>` 显式确认后才能进入 implement。Owner：`specifier`。Skill：`gxpm-specifier`。规则：`docs/governance/gherkin-style.md`。
- 进入 `implement` 之前，phase-gate 校验 `behavior-spec.confirmedAt` 非空；老 issue（在 `SPECIFY_PHASE_CUTOFF = 2026-05-14T00:00:00Z` 前已进入 implement）可豁免。
<!-- END USER-SPECIFIED -->

## 全局纪律

**所有 Agent 在所有阶段都必须遵守 `CANON.md` 中的行为宪法。** 本文档不再重复那些纪律，只保留项目级入口信息。

## Truth Sources

1. 用户本轮明确指令。
2. `CANON.md` — 全局行为宪法
3. `CONTEXT.md` — 共享语言/术语表
4. `README.md` — 产品定位与架构哲学（本文档的简化版）
5. `docs/architecture/gxpm-replacement-architecture.md`
6. `docs/architecture/gxpm-v0-contract.md`
7. `docs/architecture/layered-workflow-boundaries.md`
8. `docs/architecture/scaffold-northstar.md`
9. `docs/governance/development-contract.md`
10. `docs/governance/template-authoring.md`
11. `docs/governance/host-adapter.md`
12. `docs/governance/skill-authoring.md`
13. `docs/governance/gherkin-style.md`（specify 阶段强制规则）
14. `docs/research/pmc-gstack-skill-study.md`

如果来源冲突，先指出冲突和建议的最小安全路径。

## Reference Projects（工程实践优先参考）

以下项目作为 gxpm 工程实践与 skill 设计的参考借鉴对象，本地路径如下：

### 行为规范参考框架

- **ZeroZ-lab/unified-skills** — AI Agent 工作制度架构的完整参考实现  
  路径：`/Users/x/Desktop/Project/github/unified-skills`

  gxpm 的分层边界设计（Command / Agent / Skill / Artifact / Hook）直接继承并转译自 unified-skills 的四层分离制度。以下实践应作为 gxpm 的长期行为约束参考：

  | unified-skills 实践 | gxpm 对应层 | 借鉴状态 |
  |---|---|---|
  | CANON.md 10 条行为宪法 | `CANON.md` | ✅ 已吸收 |
  | Command 阶段协议（12 命令） | CLI phase commands + `core/phase-gates.ts` | ✅ 已转译为状态机 |
  | Agent 角色责任边界（24 角色） | `agents/*.md` + future Agent Runtime | 🟡 结构存在，Runtime 待建 |
  | Skill 能力注入（53 技能） | `skills/*/SKILL.md` | ✅ 已吸收模式 |
  | `./validate` 治理检查 | `bun run check` + `scripts/scaffold-check.ts` | ✅ 已吸收 |
  | Hooks 安全护栏（SessionStart / careful / freeze） | `core/hook-engine.ts` + `.githooks/` | ✅ 已转译 |
  | 文档产物链（`docs/features/YYYYMMDD-<name>/`） | `.gxpm/issues/<id>/artifacts/` + `reports/` | ✅ 已转译为 JSON artifact |
  | artifact_type 路由（software / document / article / deck / visual） | `issueType`（feature / meta / spike） | 🟡 可扩展 |
  | Agent Army 并行审查模式 | future Agent Runtime | 🔴 待实现 |

  **关键约束**：unified-skills 是 gxpm 的**上游行为规范来源**，不是运行时依赖。gxpm 吸收其分层原则和纪律设计，但用 state graph + capability runtime + evidence store 重新实现为可执行产品。

### 其他工程参考

- **obra/superpowers** — 代理能力编排与权限管理参考  
  路径：`/Users/x/Desktop/Project/github/superpowers`
- **garrytan/gstack** — 全栈 Agent 工具链与部署实践参考  
  路径：`/Users/x/Desktop/Project/github/gstack`
- **affaan-m/everything-claude-code** — Claude Code 扩展生态与 skill 模式参考  
  路径：`/Users/x/Desktop/Project/github/everything-claude-code`
- **Yeachan-Heo/oh-my-codex** — Codex CLI 工作流与 hook 设计参考  
  路径：`/Users/x/Desktop/Project/github/oh-my-codex`
- **mattpocock/skills** — Skill 结构与类型驱动开发实践参考  
  路径：`/Users/x/Desktop/Project/github/mattpocock-skills`

## gxpm Config

- worktree.enforcement: required
- worktree.default: ask

如需禁用 worktree，改为 `forbidden`。任何 `.gxpm/config.json` 中显式设置都会覆盖本段。

## Commands

```bash
bun test
bun run gen:skill-docs
bun run check
```

## Progressive Docs

- 全局纪律：`CANON.md`
- 产品定位与架构哲学：`README.md`
- 开发、验证、提交：`docs/governance/development-contract.md`
- skill 模板写法：`docs/governance/template-authoring.md`
- host adapter 扩展：`docs/governance/host-adapter.md`
- 产品架构：`docs/architecture/`
- 上游研究：`docs/research/`

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **gxpm** (7711 symbols, 12538 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/gxpm/context` | Codebase overview, check index freshness |
| `gitnexus://repo/gxpm/clusters` | All functional areas |
| `gitnexus://repo/gxpm/processes` | All execution flows |
| `gitnexus://repo/gxpm/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
