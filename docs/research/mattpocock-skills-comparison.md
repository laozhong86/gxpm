# Matt Pocock Skills vs gxpm Skills — 对标分析与集成方案

> 研究日期：2026-05-02
> 来源：https://github.com/mattpocock/skills

---

## 一、总体能力地图

### Matt Pocock Skills（21 个）

| 分类 | Skill | 核心能力 | 复杂度 |
|------|-------|---------|--------|
| **Engineering** | diagnose | 六阶段纪律化调试（反馈循环→复现→假设→探测→修复→复盘） | 高 |
| | grill-with-docs | 带文档的对齐拷问 + 实时写 CONTEXT.md/ADR | 高 |
| | improve-codebase-architecture | 深度模块识别、架构深化建议 | 高 |
| | setup-matt-pocock-skills | 仓库级 skill 配置脚手架 | 中 |
| | tdd | 垂直切片红绿重构、测试纪律 | 高 |
| | to-issues | PRD → 垂直切片 issue | 中 |
| | to-prd | 对话上下文 → PRD | 中 |
| | triage | issue 分诊状态机（5 角色） | 中 |
| | zoom-out | 全局视角/模块地图 | 低 |
| **Productivity** | caveman | 超压缩通信模式（省 token ~75%） | 低 |
| | grill-me | 基础版拷问对齐（无文档产出） | 中 |
| | write-a-skill | Skill  authoring 脚手架 | 中 |
| **Misc** | git-guardrails-claude-code | PreToolUse hook 拦截危险 git 操作 | 中 |
| | migrate-to-shoehorn | 测试类型断言迁移 | 低 |
| | scaffold-exercises | 练习目录脚手架 | 低 |
| | setup-pre-commit | Husky + lint-staged + Prettier 初始化 | 低 |
| **Personal** | edit-article | 文章编辑优化 | 低 |
| | obsidian-vault | Obsidian 笔记管理 | 低 |
| **Deprecated** | design-an-interface, qa, request-refactor-plan, ubiquitous-language | 已废弃 | - |

### gxpm 当前 Skills（5 个）

| Skill | 核心能力 | 宿主 |
|-------|---------|------|
| **gxpm** | 状态图驱动的 issue 交付闭环（triage→plan→dispatch→implement→…→land） | Codex CLI |
| **debug-issue** | GitNexus 驱动的调试（语义搜索→调用链→影响半径） | Claude Code |
| **explore-codebase** | GitNexus 驱动的代码库探索（架构概览→社区→执行流） | Claude Code |
| **refactor-safely** | GitNexus 驱动的安全重构（建议→死代码→重命名预览） | Claude Code |
| **review-changes** | GitNexus 驱动的变更评审（风险评分→影响流→测试覆盖） | Claude Code |

---

## 二、逐 Skill 对标分析

### 1. diagnose（Matt） vs debug-issue（gxpm）

| 维度 | Matt diagnose | gxpm debug-issue |
|------|--------------|------------------|
| **哲学** | "反馈循环是调试的全部" — 先建可自动运行的 pass/fail 信号 | "图谱是调试的地图" — 先找相关代码和执行路径 |
| **方法** | 六阶段流程：建循环→复现→假设→探测→修复→复盘 | 五步图谱查询：语义搜索→调用链→执行流→变更检测→影响半径 |
| **工具链** | 测试、curl、CLI、headless browser、trace 回放、property fuzz | GitNexus MCP（query, context, impact, detect_changes） |
| **人工介入** | HITL bash script 作为最后手段 | 无明确 HITL 设计 |
| **产出** | 回归测试、清理后的代码、假设记录、架构改进建议 | 问题定位报告 |
| **token 效率** | 无明确约束 | **强制 ≤5 工具调用 / ≤800 tokens** |

**差距**：
- gxpm 的 debug-issue 缺少 **"先建反馈循环"** 的核心纪律。它直接跳到代码定位，但如果没有可复现的测试/脚本，定位到了也难以验证修复。
- Matt 的 diagnose 有 **假设排序 + 可证伪性** 要求，gxpm 没有结构化假设管理。
- Matt 有 **性能分支**（profiler、baseline measurement），gxpm 完全缺失。
- gxpm 有 **token 效率强制约束**，Matt 没有 — 这是 gxpm 的优势。

**集成方案**：
1. 将 Matt 的"Phase 1 建立反馈循环"作为 debug-issue 的前置步骤，用 gxpm 的 `--probe-cli` 验证测试命令有效性。
2. 在 debug-issue 中加入"生成 3-5 个排序假设"的环节，用 `gxpm artifact write` 持久化。
3. 将 gxpm 的 token 效率规则注入 Matt 的 diagnose（每次探测必须映射到具体假设）。
4. 性能回归场景：当 `gxpm issue` 标记为性能类型时，先跑 `bun test --bench` 或类似基线，再进入图谱查询。

---

### 2. grill-with-docs / grill-me（Matt） vs gxpm triage/plan

| 维度 | Matt grill-* | gxpm triage/plan |
|------|-------------|------------------|
| **触发时机** | 任何计划/设计变更前 | issue 创建后按 phase 推进 |
| **交互方式** | 一问一答，逐条深入 | brainstorming gate（一次性呈现目标/范围/标准） |
| **术语管理** | **实时维护 CONTEXT.md**，冲突立即指出 | AGENTS.md 有静态术语，但无动态冲突检测 |
| **决策记录** | **ADR 即时产出**（满足三条件才写） | `implementation-plan` / `triage-report` artifact 必须写 |
| **产出格式** | CONTEXT.md + ADR（自由文档） | JSON artifact（机器可读） |
| **状态绑定** | 无状态机，纯对话驱动 | 严格 phase gate |

**差距**：
- gxpm 的 triage/plan 是 **"呈现→确认→推进"** 的单次 gate，缺少 Matt 的 **逐条 grilling 深度**。
- gxpm 没有 **共享语言（CONTEXT.md）** 的持续维护机制。AGENTS.md 是静态的，不随项目演化。
- Matt 的 ADR 质量门槛很高（难逆转 + 出乎意料 + 真实权衡），gxpm 的 artifact 写作门槛相对较低。
- gxpm 的 artifact 是 JSON 机器格式，不利于人类阅读术语演变历史。

**集成方案**：
1. **引入 `/grill-with-docs` 作为 triage 的可选子模式**：当 issue 涉及新领域术语或重大架构决策时，在 `gxpm triage init` 后触发 grilling 会话。
2. **创建 `CONTEXT.md` 机制**：在 gxpm 仓库根目录维护 `CONTEXT.md`，由 grill 会话实时更新。与 AGENTS.md 分工：AGENTS.md 管"规则"，CONTEXT.md 管"语言"。
3. **ADR 质量门**：在 `plan → dispatch` 的 transition 检查中，增加"是否有需要记录的架构决策"的提示。
4. **术语冲突检测**：在 gxpm 的 UserPromptSubmit hook 或 `gxpm wiki context` 中，加入术语一致性检查。

---

### 3. improve-codebase-architecture（Matt） vs refactor-safely（gxpm）

| 维度 | Matt improve-codebase-architecture | gxpm refactor-safely |
|------|-----------------------------------|----------------------|
| **目标** | 识别 deepening 机会（浅→深模块） | 执行安全重构（重命名、死代码清理） |
| **方法** | Deletion test + 领域术语 + ADR 交叉引用 | GitNexus refactor + impact analysis |
| **交互** | 列出候选 → 用户选 → grilling 设计细节 | 自动分析 → 预览 → 应用 |
| **产出** | 设计讨论 + CONTEXT.md 更新 + 可选 ADR | 代码变更 + 变更验证 |
| **执行** | **只建议，不执行** | **建议 + 可执行** |

**差距**：
- Matt 是 **架构咨询**（发现机会、讨论设计），gxpm 是 **重构执行**（安全地改代码）。两者互补但不在同一层。
- Matt 强调 **"deep modules" 和 "seam"** 概念，gxpm 的 refactor-safely 没有这些架构词汇。
- gxpm 的图谱工具可以量化影响半径，Matt 的方法论可以解释"为什么这里应该重构"。

**集成方案**：
1. **将 improve-codebase-architecture 作为 gxpm 的独立 skill**：定期（如每 sprint）运行，产出 deepening 候选列表写入 `gxpm artifact`。
2. ** refactor-safely 执行前，先过 architecture 审视**：对于大重构，先问"这符合 deep module 原则吗？"
3. **在 refactor-safely 中注入 Matt 的词汇**：将 GitNexus `impact` 的结果解释为"seam 影响范围"，将大函数/浅模块候选解释为"shallow module 候选"。

---

### 4. tdd（Matt） vs gxpm implement

| 维度 | Matt tdd | gxpm implement |
|------|---------|----------------|
| **核心纪律** | 垂直切片（一个测试→一个实现→重复） | 按 implementation-plan 执行，worktree 隔离 |
| **测试哲学** | 测试行为而非实现；集成测试优先；禁止过度 mock | 依赖项目现有测试框架，无明确测试哲学 |
| **红绿循环** | 明确 RED→GREEN→REFACTOR 节奏 | 无明确节奏要求 |
| **接口设计** | 先设计可测试接口（deep module 接口） | 按 plan 执行，接口设计在 plan 阶段完成 |
| **反馈循环** | 每次 slice 都有即时测试反馈 | 依赖 local-verify 阶段统一验证 |

**差距**：
- gxpm 的 implement 阶段是 **"按蓝图施工"**，缺少 Matt 的 **"小步快跑+即时反馈"** 纪律。
- gxpm 没有 **垂直切片** 概念。一个 issue 可能很大，implement 阶段没有内部再切分机制。
- Matt 明确禁止水平切片（先写所有测试），gxpm 没有此约束。

**集成方案**：
1. **在 implement 阶段引入 tracer bullet**：第一个子任务必须是"写一个端到端测试证明路径打通"。
2. **将 Matt 的垂直切片作为 implement 的内部纪律**：`gxpm artifact write local-verify` 之前，要求提供"测试增量列表"。
3. **在 gxpm 的 `bun test` 检查中加入 tdd 哲学提醒**：例如如果测试全是 mock，提示"测试实现细节风险"。
4. **worktree 内的开发节奏**：`gxpm run start` 后，推荐 RED→GREEN→REFACTOR 循环，用 `gxpm run event` 记录每个 slice。

---

### 5. to-issues / to-prd（Matt） vs gxpm issue create / plan

| 维度 | Matt to-issues / to-prd | gxpm issue create / plan |
|------|------------------------|--------------------------|
| **Issue 来源** | PRD 切分、对话上下文合成 | Linear 同步、用户显式创建 |
| **切分单位** | **垂直切片**（端到端可验证） | 默认按功能模块或用户故事 |
| **AFK vs HITL** | 明确区分代理可自主 vs 需人工 | `claim/release/reconcile-claim` 管理执行权 |
| **产出** | GitHub/GitLab issue + triage label | `.gxpm/issues/<id>/` JSON 状态 + artifact |
| **Issue tracker** | GitHub / GitLab / Local markdown | Linear（协作前门）+ `.gxpm`（本地真值） |

**差距**：
- Matt 的 to-issues 有 **明确的垂直切片规则**（每个 slice 端到端、可演示），gxpm 没有此约束。
- gxpm 的 issue 创建更偏向 **状态管理**（phase、artifact、claim），Matt 更偏向 **内容质量**（PRD 模板、验收标准）。
- Matt 的 issue 进入 `needs-triage` label 流转，gxpm 进入 phase gate 流转 — 两者可以互补。

**集成方案**：
1. **在 `gxpm plan init` 后引入 to-issues 逻辑**：如果 implementation-plan 过大，自动建议切分为多个 GXPM-N issue，每个都是垂直切片。
2. **引入 PRD 模板**：`gxpm artifact write <id> implementation-plan` 的 JSON schema 可以扩展一个 `prd` 字段，包含 Problem Statement、User Stories、Implementation Decisions、Testing Decisions、Out of Scope。
3. **AFK/HITL 标记**：在 `gxpm issue create` 支持 `--mode afk|hitl` 标记，影响 dispatch 时的 claim 策略。

---

### 6. triage（Matt） vs gxpm triage

| 维度 | Matt triage | gxpm triage |
|------|------------|-------------|
| **状态机** | 5 个 state role + 2 个 category role | 单 phase（triage）→ 必须产 acceptance-contract |
| **分诊动作** | 查看/评估/标记/写 brief | `gxpm triage init` 写 acceptance-contract |
| **Agent brief** | `ready-for-agent` 时写 agent brief | `dispatch-handoff` artifact 类似功能 |
| **Out-of-scope** | `.out-of-scope/` 知识库 | 无明确 out-of-scope 存档机制 |
| **复现要求** | bug 必须尝试复现 | 无强制复现要求 |

**差距**：
- Matt 的 triage 是一个 **完整的状态机**，gxpm 的 triage 只是一个 **phase gate**（进入即开始写 acceptance-contract）。
- Matt 要求 **bug 必须先复现**，gxpm 没有这个纪律。
- Matt 的 `.out-of-scope/` 是**拒绝原因的知识库**，防止重复讨论同一问题。gxpm 没有此机制。
- gxpm 的 `acceptance-contract` 是 JSON，Matt 的 triage notes 是 markdown — 前者机器可读，后者人类友好。

**集成方案**：
1. **在 gxpm triage 中加入复现检查**：如果 issue 是 bug 类型，`acceptance-contract` 必须包含 `reproduction` 字段（测试命令、复现步骤或"无法复现"结论）。
2. **引入 `.gxpm/out-of-scope/`**：作为拒绝 issue 的知识库，与 `.out-of-scope/` 概念对齐。`gxpm issue archive` 可扩展为带原因的归档。
3. **保留 Matt 的 triage 角色语义**：在 `acceptance-contract` 中增加 `triageRole` 字段（needs-info / ready-for-agent / ready-for-human / wontfix）。

---

### 7. setup-matt-pocock-skills（Matt） vs gxpm-init

| 维度 | Matt setup | gxpm-init |
|------|-----------|-----------|
| **范围** | 配置 issue tracker、label、domain docs 布局 | 安装 skill、git hooks、codex hooks |
| **配置内容** | `docs/agents/` 下的 issue-tracker.md、triage-labels.md、domain.md | `.githooks/` + `.codex/hooks/` + skill 复制 |
| **目标** | 让 skill 知道"这个仓库怎么运作" | 让仓库具备 gxpm 执行能力 |

**差距**：
- Matt 的配置是 **"仓库自传"**（告诉 skill 我的 issue 在哪、标签叫什么），gxpm-init 是 **"能力安装"**（给仓库装钩子）。
- gxpm 已经有 `docs/agents/` 的雏形（AGENTS.md、CLAUDE.md），但缺少 **issue tracker 配置**、**label 映射** 的显式文档。

**集成方案**：
1. **在 `gxpm-init` 中加入 Matt 式的仓库自传配置**：安装时询问 issue tracker（GitHub/Linear/Local）、triage 标签映射、domain docs 布局。
2. **统一配置位置**：将 `docs/agents/` 作为 gxpm 的约定配置目录，与 `docs/governance/` 互补。
3. **让 gxpm skill 读取 `docs/agents/` 配置**：`setup-matt-pocock-skills` 的产物可以被 gxpm 的 hooks 和 skill 消费。

---

### 8. caveman（Matt） — gxpm 无对应

**分析**：caveman 是一个通信层 skill，与 gxpm 的交付流程正交。但它省 token 的效果对 gxpm 很有价值 —— gxpm 的 phase gate 和 artifact 写入本身就很重，如果能用 caveman 压缩中间通信，可以显著降低成本。

**集成方案**：
1. 作为可选的 **session-level 通信模式**，在 `gxpm config` 中增加 `communication.mode: concise|caveman|normal`。
2. 在 agent hook 中注入 caveman prompt，当用户说"caveman mode"或 token 紧张时激活。

---

### 9. git-guardrails-claude-code（Matt） vs gxpm git hooks

| 维度 | Matt git-guardrails | gxpm git hooks |
|------|--------------------|----------------|
| **机制** | Claude Code PreToolUse hook（拦截 bash 命令） | git hooks（pre-commit, commit-msg, pre-push, post-merge） |
| **拦截范围** | push, reset --hard, clean, branch -D, checkout . | commit 路径保护、commit message 格式、push artifact 检查 |
| **目标** | 防止代理误操作 | 防止 phase gate 被绕过 |

**差距**：
- Matt 是 **运行时命令拦截**（Claude 层面），gxpm 是 **git 事件拦截**（git 层面）。两者互补。
- gxpm 缺少 **reset --hard / clean / branch -D** 的防护。代理在 worktree 中误操作可能丢失代码。
- Matt 的 guardrails 只覆盖 Claude Code，gxpm 的 hooks 是 git 原生，宿主无关。

**集成方案**：
1. **在 gxpm 的 `.githooks/` 中增加 `gxpm-pre-run` 或类似 hook**：拦截危险的 shell 命令。或者通过 Codex/Claude 的 PreToolUse hook 实现。
2. **统一逃生口**：Matt 用 `GXPM_GATE_DISABLE=1`，gxpm 也用 `GXPM_GATE_DISABLE=1` —— 已对齐。
3. **将 Matt 的 block-dangerous-git.sh 作为 gxpm 的可选 hook 组件**：`gxpm-init --install-git-guardrails`。

---

### 10. write-a-skill（Matt） vs gxpm skill 体系

| 维度 | Matt write-a-skill | gxpm skill 管理 |
|------|-------------------|-----------------|
| **定位** | 教用户如何写新 skill | skill 由项目维护，通过 `gen:skill-docs` 生成 |
| **结构** | SKILL.md + REFERENCE.md + EXAMPLES.md + scripts/ | SKILL.md.tmpl → SKILL.md（生成式） |
| **质量检查** | 描述必须含触发词、SKILL.md <100 行、无时间敏感信息 | AGENTS.md 约束 + `bun run check` |
| **范围** | 任意 agent skill | gxpm 主 skill + GitNexus code-intelligence skills |

**差距**：
- gxpm 的 skill 是 **项目维护的**，用户（agent）不直接写 skill。Matt 的 write-a-skill 是 **用户自助扩展**。
- gxpm 的 skill 生成通过 `gen:skill-docs`（模板驱动），Matt 是手工编写。
- gxpm 缺少 **skill authoring 指南** 和 **质量 rubric**。

**集成方案**：
1. **在 `docs/governance/` 下增加 `skill-authoring.md`**，吸收 Matt 的 write-a-skill 规范（描述格式、触发词、文件拆分规则）。
2. **扩展 `gen:skill-docs` 的模板**：在 SKILL.md.tmpl 中加入 Matt 的 progressive disclosure 结构（Quick start → Workflows → Advanced features）。
3. **技能园丁（skill-gardener）**：用户已有此 skill，可以结合 Matt 的结构规范和 gxpm 的生成流程，做 skill 质量审计。

---

### 11. setup-pre-commit / scaffold-exercises / migrate-to-shoehorn（Matt）

这些是 **具体技术栈的脚手架 skill**，与 gxpm 的项目管理核心无直接冲突。

**集成方案**：
- `setup-pre-commit`：gxpm 的 `bun run check` 已覆盖 lint + typecheck + test，但缺少 Husky 的 commit-time 自动运行。可作为可选初始化项。
- `scaffold-exercises`：与 gxpm 无关，除非 gxpm 未来需要课程/教程体系。
- `migrate-to-shoehorn`：TypeScript 测试专用，可作为 gxpm 测试改进的一个参考模式。

---

### 12. zoom-out（Matt） vs explore-codebase（gxpm）

| 维度 | Matt zoom-out | gxpm explore-codebase |
|------|--------------|----------------------|
| **触发** | "我不熟悉这块代码" | 系统性代码库探索 |
| **方法** | 上升一层抽象，用领域术语画模块地图 | GitNexus 的 query → architecture → communities → flows |
| **产出** | 模块地图 + 调用关系描述 | 架构概览 + 执行路径 + 社区结构 |

**差距**：
- zoom-out 是 **轻量级、反应式** 的（看到陌生代码时问一下），explore-codebase 是 **重量级、主动式** 的（系统性探索）。
- explore-codebase 有 **量化指标**（社区检测、大型函数），zoom-out 只有 **定性描述**。
- zoom-out 强调 **领域术语**，explore-codebase 缺少术语一致性约束。

**集成方案**：
1. **将 zoom-out 作为 explore-codebase 的子模式**：当用户说"zoom out"或"我不熟悉这块"时，用图谱工具生成模块地图，但用领域术语（来自 CONTEXT.md）重新标注。
2. **在 explore-codebase 的输出中强制使用 CONTEXT.md 术语**：将图谱的原始符号名映射到领域词汇。

---

## 三、Matt Pocock 独有而 gxpm 缺失的能力

| 能力 | 重要性 | 集成优先级 |
|------|--------|-----------|
| **CONTEXT.md + 实时术语维护** | 🔴 极高 | P0 — 补充到 AGENTS.md 体系 |
| **ADR 质量门槛**（难逆转+出乎意料+真实权衡） | 🔴 极高 | P0 — 在 plan 阶段增加 ADR 检查 |
| **垂直切片 issue 拆分** | 🔴 极高 | P0 — 在 plan → dispatch 之间加入 |
| **TDD 垂直切片纪律** | 🟡 高 | P1 — 在 implement 阶段引入 tracer bullet |
| **Bug 复现强制检查** | 🟡 高 | P1 — 在 triage acceptance-contract 中加入 |
| **Out-of-scope 知识库** | 🟡 高 | P1 — 扩展 archive 功能 |
| **caveman 通信模式** | 🟢 中 | P2 — 作为 config 选项 |
| **Git 危险命令 PreToolUse 拦截** | 🟢 中 | P2 — 在 Codex hook 层实现 |
| **Pre-commit 脚手架** | 🟢 中 | P2 — 作为 gxpm-init 选项 |

---

## 四、gxpm 独有而 Matt Pocock 缺失的能力

| 能力 | gxpm 优势 |
|------|----------|
| **状态图驱动的 phase gate** | Matt 的 skill 是松散集合，gxpm 是严格的执行流水线 |
| **Artifact 机器可读真值** | Matt 的文档是人类友好但机器难解析，gxpm 的 JSON 是机器真值 |
| **Worktree 隔离 + Claim 机制** | Matt 没有代码隔离和并发执行管理 |
| **Native wiki engine** | Matt 依赖外部知识管理，gxpm 有 `gxpm wiki` |
| **GitNexus 集成** | Matt 的 skill 是文本驱动，gxpm 有图谱驱动的导航 |
| **Token 效率强制约束** | gxpm 的 GitNexus code-intelligence skill 有 ≤5 调用 / ≤800 tokens 规则 |
| **Linear 协作前门** | Matt 只支持 GitHub/GitLab，gxpm 以 Linear 为协作界面 |
| **Host 适配层**（Codex/Claude 双宿主） | Matt 的 skill 主要面向 Claude Code |
| **Git hook 物理 gate** | Matt 只有 Claude Code 的 PreToolUse hook，gxpm 有 git-native hook |

---

## 五、集成架构建议

### 5.1 文件布局

```
gxpm/
├── skills/
│   ├── gxpm/                    # 主 skill（不变）
│   ├── diagnose/                # 新增：Matt diagnose + gxpm debug-issue 融合
│   ├── grill/                   # 新增：grill-me + grill-with-docs
│   ├── architecture/            # 新增：improve-codebase-architecture
│   ├── tdd/                     # 新增：tdd 纪律
│   └── issue-planning/          # 新增：to-prd + to-issues
├── .claude/skills/
│   ├── debug-issue.md           # 保留，增强 feedback-loop 前置
│   ├── explore-codebase.md      # 保留，增强 CONTEXT.md 术语映射
│   ├── refactor-safely.md       # 保留，增强 deep-module 语义
│   └── review-changes.md        # 保留
├── CONTEXT.md                   # 新增：共享语言/术语表
├── docs/agents/
│   ├── issue-tracker.md         # 新增：issue tracker 配置
│   ├── triage-labels.md         # 新增：triage 标签映射
│   └── domain.md                # 新增：domain docs 布局规则
└── docs/governance/
    ├── skill-authoring.md       # 新增：skill 编写规范
    └── development-contract.md  # 已有，可扩展
```

### 5.2 Phase 集成点

```
triage
  ├── 新增：bug 复现检查（来自 diagnose Phase 2）
  ├── 新增：术语冲突检测（来自 grill-with-docs）
  └── 新增：out-of-scope 知识库查询

plan
  ├── 新增：grilling 会话（可选，针对重大决策）
  ├── 新增：垂直切片分析（来自 to-issues）
  ├── 新增：ADR 质量门（来自 grill-with-docs）
  └── 扩展：PRD 模板（来自 to-prd）

dispatch
  └── 新增：AFK/HITL 模式标记

implement
  ├── 新增：tracer bullet 首测试
  ├── 新增：垂直切片 RED→GREEN→REFACTOR
  └── 增强：deep-module 接口设计检查

local-verify
  └── 增强：回归测试必须先于修复

self-review
  └── 新增：deletion test（模块深度检查）

land
  └── 清理后：architecture 复盘建议（可选触发 improve-codebase-architecture）
```

### 5.3 最小可行集成（MVP）

**第一步：引入 CONTEXT.md**
- 在仓库根创建 `CONTEXT.md`
- 将 AGENTS.md 中的术语定义（issue tracker、issue、triage role 等）迁移到 `CONTEXT.md`
- AGENTS.md 引用 `CONTEXT.md`
- `grill-with-docs` 会话可更新 `CONTEXT.md`

**第二步：增强 triage artifact**
- `acceptance-contract` JSON schema 增加 `reproduction` 字段（bug 类型必填）
- `acceptance-contract` 增加 `triageRole` 字段（needs-info / ready-for-agent / ready-for-human / wontfix）
- 创建 `.gxpm/out-of-scope/` 或扩展 archive 语义

**第三步：增强 plan artifact**
- `implementation-plan` 扩展 PRD 风格字段：Problem Statement、User Stories、Testing Decisions、Out of Scope
- plan phase 支持可选的 `/grill-with-docs` 子模式
- 大 plan 自动建议垂直切片为多个 issue

**第四步：增强 implement 纪律**
- implement 阶段首条必须是 tracer bullet（端到端测试/验证）
- `local-verify` artifact 要求列出"已完成的测试切片"

**第五步：诊断融合**
- 创建 `skills/diagnose/`，融合 Matt 的六阶段 + gxpm 的图谱导航
- debug-issue skill 增加"Phase 1 建立反馈循环"前置步骤

---

## 六、风险评估

| 风险 | 影响 | 缓解 |
|------|------|------|
| CONTEXT.md 与 AGENTS.md 职责重叠 | 维护混乱 | 明确分工：AGENTS.md = 规则/流程，CONTEXT.md = 语言/术语 |
| Matt skill 的"自由文档"与 gxpm 的"JSON artifact"冲突 | 双轨制真值 | 保持 JSON 为机器真值，文档为人类视图；用 `gxpm artifact read` 渲染 markdown |
| 过度集成导致 gxpm 变重 | 失去简洁性 | 采用可选/渐进式集成：技能作为可选子模式，不强制 |
| Matt skill 假设 Claude Code，gxpm 主宿主是 Codex | 宿主差异 | 将 Matt 的 skill 改写为宿主无关文本，通过 gxpm skill 层统一暴露 |

---

## 七、结论

Matt Pocock 的 skills 是 **"工程纪律的文本化"** —— 将调试、对齐、TDD、架构审视等经典工程实践压缩为 agent 可执行的 prompt 模板。

gxpm 的 skills 是 **"交付流水线的自动化"** —— 将 issue 交付的状态图、artifact 真值、worktree 隔离、图谱导航编织为机器可执行的运行时。

两者不是替代关系，而是 **互补层**：
- **Matt 的 skill 回答"怎么做对"**（工程纪律）
- **gxpm 的 skill 回答"怎么走完"**（执行闭环）

**最佳集成策略**：把 Matt 的纪律作为 gxpm phase gate 的**可选增强层**，而非平行替代。保持 gxpm 的状态图和 artifact 真值不变，在每个 phase 中引入 Matt 的方法论作为质量检查点和工具箱。
