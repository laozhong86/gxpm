# gxpm Agent Contract

## Role

gxpm 是面向完全替代 `pmc` 和 `gstack` 的第二代代理项目管理产品。PMC 和 gstack 是上游研究对象与能力来源，不是 gxpm 的长期运行依赖。

<!-- BEGIN USER-SPECIFIED -->
gxpm 不是 PMC 的兼容壳，也不是 gstack 的插件集合。所有设计都要服务于独立产品闭环：统一 state graph、capability runtime、browser evidence、review/ship governance 和 agent execution loop。
<!-- END USER-SPECIFIED -->

## Truth Sources

1. 用户本轮明确指令。
2. `CONTEXT.md` — 共享语言/术语表（领域词汇的单一真相源）
3. `docs/architecture/gxpm-replacement-architecture.md`
4. `docs/architecture/gxpm-v0-contract.md`
5. `docs/architecture/scaffold-northstar.md`
6. `docs/governance/development-contract.md`
7. `docs/governance/template-authoring.md`
8. `docs/governance/host-adapter.md`
9. `docs/governance/skill-authoring.md`
10. `docs/research/pmc-gstack-skill-study.md`

如果来源冲突，先指出冲突和建议的最小安全路径。

## Reference Projects（工程实践优先参考）

以下项目作为 gxpm 工程实践与 skill 设计的参考借鉴对象，本地路径如下：

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

## Always

- 全程中文沟通，汇报包含路径、命令和验证证据。
- 先读本仓库真值和相关上游 skill/source，再改文件。
- 编辑 skill 时改 `*.tmpl`，再运行 `bun run gen:skill-docs`；不要手改生成产物当真值。
- 把 Linear 当协作前门，把 `.gxpm` 本地 state/artifacts 当未来执行真值。
- browser/QA/review/ship 相关结论必须能落到可复核证据。
- 新增 host、skill、生成规则时同步补测试或检查入口。

## Code Intelligence (code-review-graph)

本仓库已集成 `code-review-graph` MCP 工具（本地 SQLite 图谱，~980 nodes / ~16k edges，含 Leiden 社区检测与向量语义搜索）。

**优先使用 MCP 的场景**（这些情况下优先于 `ls`/`grep`/`cat`）：
- 用自然语言搜索符号（函数、类），不确定精确命名时。
- 分析调用关系（谁调用了谁、谁被谁调用）。
- 评估代码变更的影响半径。
- 探索模块执行流或架构社区划分。
- 识别架构热点（高连接度节点、桥接点）。

**必须回退到 grep / ReadFile 的场景**：
- 搜索字符串字面量、日志文本、注释内容。
- 读取配置文件（yaml、json、toml）或 markdown 文档内容。
- 需要精确行号或源码细读时。
- 查询内部/私有函数的测试覆盖（图数据库仅索引导出符号的直接测试关系）。

**工作流原则**：先用 MCP 定位符号和社区边界，再用 grep / ReadFile 精读源码；避免在不可索引的内容上反复尝试 MCP。

## gxpm Config

- worktree.enforcement: optional
- worktree.default: ask

如需强制走 worktree-first，把 enforcement 改为 `required`；如禁用 worktree，改为 `forbidden`。任何 `.gxpm/config.json` 中显式设置都会覆盖本段。

## gxpm Workflow (本仓库自托管)

本仓库使用 gxpm 自托管 issue delivery。任何涉及 issue / phase / artifact 的工作，都必须遵循以下流程，不得绕过：

- 纯启动时 SessionStart hook 只注入 gxpm 能力提醒，不会列出 issue；用户在 prompt 里提及 `GXPM-N` / `GXG-N` 时，UserPromptSubmit hook 才注入该 issue 的 status + next。继续某个 issue 时先明确 id，再 `gxpm issue status <id>` + `gxpm issue next <id>` 拉取上下文，**不要从聊天记忆推断 phase**。
- session ownership 是软状态，不是锁。任何 artifact / phase 写入都会 touch 当前 session；只有当 prompt 命中该 issue 且当前 session 曾经拥有过它时，hook 才提示 ownership 已转移。
- 任何代码改动开始前，确认有对应 GXPM-N issue 处于 `dispatch` / `implement` 之间的阶段；否则先 `gxpm issue create --auto-id` 并走 triage → plan → dispatch 三阶段。**永远使用 `--auto-id`**，不要硬编码 GXPM-N 数字（避免与已有跟踪 issue 冲突）。
- meta tracker、retro、长期观察日志必须用 `gxpm issue create --auto-id --type meta` 创建；否则会污染默认 `gxpm issue list` 的功能交付视图。spike 仅用于限时调查，不改变 phase gate。
- 新的非平凡任务先走 brainstorming/需求确认：只做 read-only 真值检查，向用户确认目标、范围、非目标、成功标准和预计改动；用户点头后再写 artifact、改文件或执行有副作用命令。用户明确说“直接做 / 继续推进 / 按已有计划执行”时可跳过。
- Phase 推进前先写完 artifact，再 `gxpm issue transition`（顺序：`gxpm <phase> init <id>` → `gxpm artifact write <id> <type> --json '...'` → `gxpm issue transition <id> <next>`）。
- **设计提议必须落盘**：在 triage/plan 阶段产出的方案、取舍、替代选项必须写到对应 artifact (triage-report / implementation-plan)，**不能只留在聊天里**；下一个会话只读 `.gxpm/issues/<id>/` 也能恢复上下文是底线。
- 不要直接编辑 `.gxpm/issues/<id>/*.json`，统一通过 `gxpm artifact write` / `gxpm artifact edit`。
- Commit message 必须含 `GXPM-N` 引用；feature 分支用 `gxpm-N-<topic>` 命名以触发 git hook gate。
- 完成 land phase 前的 merge 由 post-merge hook 自动 transition qa→land；不手工跳。
- `land` 完成后默认运行 `gxpm cleanup land <id> --execute` 清理本地 worktree 和 feature branch；若保留，必须在 `land-findings` 写 `retainWorktreeReason`。
- 不确定下一步时统一查 `gxpm issue next <id>`，不要自己拼 CLI。
- 进入 implement 前 `git status -sb` 检查未追踪文件；如有 3+ 个来源不明文件，**默认走独立 worktree** 隔离（不依赖 worktree.enforcement 设置）。
- **`git worktree add` 之后必须 `cd` 进新 worktree 才能动代码**。Codex 的 `apply_patch` / 写文件命令以 cwd 为路径根，光建 worktree 不切目录，写出去的文件仍落主仓库。每次进入 worktree 必须先 `cd /Users/x/Desktop/Project/gxpm-worktrees/<name>` 再编辑。
- Codex 的 `update_plan` 仅用于阶段内细分任务，**不要与 gxpm phase 平行作为顶层 task list**；顶层进度永远以 `gxpm issue history <id>` 为准。

## Ask First

- destructive cleanup、发布、合并、远端写操作。
- 改变 gxpm 产品定位、phase 集合、state 真值优先级。
- 引入 PMC/gstack 运行时依赖，而不是作为迁移/研究来源。
- 需要付费 eval、外部 API、长时间浏览器/E2E 验证。

## Never

- 不把 gxpm 写成 PMC/gstack wrapper。
- 不从聊天记忆推断 phase 或完成状态。
- 不把 generated `SKILL.md` 冲突用“接受某一边”解决。
- 不声称历史失败与本次无关，除非有 base/main 对照证据。
- 不把大段项目结构或可由代码推断的信息塞回默认加载文件。

## Commands

```bash
bun test
bun run gen:skill-docs
bun run check
```

## Progressive Docs

- 开发、验证、提交：`docs/governance/development-contract.md`
- skill 模板写法：`docs/governance/template-authoring.md`
- host adapter 扩展：`docs/governance/host-adapter.md`
- 产品架构：`docs/architecture/`
- 上游研究：`docs/research/`
