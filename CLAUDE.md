# gxpm Claude Bootstrap

本文件只承担 Claude Code 的薄启动层。共享执行合同以 `AGENTS.md` 为准。

## Load Order

1. 先读 `AGENTS.md`。
2. 涉及开发规范时读 `docs/governance/development-contract.md`。
3. 涉及 skill 文档或 prompt 模板时读 `docs/governance/template-authoring.md`。
4. 涉及 Codex/Claude/未来 host 输出时读 `docs/governance/host-adapter.md`。

## Claude-Specific Notes

- 不要把 `/pm` 当 gxpm 的最终入口；PMC 只作为上游参考。
- 不要把 `/qa`、`/review`、`/ship` 的 gstack 实现直接 vendoring 到 gxpm；先抽象为 gxpm capability。
- 如果本地 `.claude/` 未来被脚手架生成或 symlink 到工作区，先确认 live install 风险，再改模板或生成器。

## GitNexus 索引刷新 ⚠️

如果下方 GitNexus 块或任何 `gitnexus_*` 工具提示 "index is stale"，**请运行 `bun run nexus`**（而非 `npx gitnexus analyze`）。

- `bun run nexus` → `gitnexus analyze --skip-agents-md`：日常索引刷新，不会改写 `AGENTS.md` / `CLAUDE.md`。
- `bun run nexus:full` → `gitnexus analyze`：包含文档统计回写的完整索引，会把 `AGENTS.md` 扩张到 ~182 行，**触发 `prepublishOnly` 的 ≤150 行 governance gate**，发版前必须 `git checkout -- AGENTS.md CLAUDE.md` 复原。

直接跑 `npx gitnexus analyze` 等价于 `bun run nexus:full`，会触发同一陷阱。下方 gitnexus block 内的旧提示（`npx gitnexus analyze`）由 GitNexus 自动生成、此处不可修改，请以本节为准。

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
