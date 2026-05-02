# superpowers 工程实践研究报告

> 研究日期：2026-05-02
> 来源：obra/superpowers（本地路径 `/Users/x/Desktop/Project/github/superpowers`）
> 研究目的：提取对 gxpm 有参考价值的工程实践，建立快速适配索引

---

## 一、项目定位

**superpowers** 是由 Jesse Vincent 创建的多宿主代理能力编排框架（multi-harness agentic skills framework）。核心定位是：通过可组合的技能（skills）和引导式指令，为编码代理提供完整的软件开发方法论。

它不是独立运行时，而是**依赖宿主平台原生机制**的 skill 编排层，支持 Claude Code、Codex CLI、Cursor、OpenCode、Gemini CLI、Copilot CLI 六大宿主。

---

## 二、架构与目录结构

```
superpowers/
├── .claude-plugin/          # Claude Code 插件配置
├── .codex-plugin/           # Codex CLI 插件配置
├── .cursor-plugin/          # Cursor 插件配置
├── .opencode/               # OpenCode 插件（JS 运行时）
├── agents/                  # 预定义子代理模板
├── commands/                # 已废弃的 legacy 命令入口
├── docs/                    # 架构演进计划与自托管设计文档
├── hooks/                   # SessionStart hook 注入系统
│   ├── hooks.json           # Claude Code hook 配置
│   ├── hooks-cursor.json    # Cursor hook 配置
│   ├── run-hook.cmd         # 跨平台 polyglot wrapper
│   └── session-start        # bash 引导脚本
├── skills/                  # 核心技能库（14 个技能）
│   ├── using-superpowers/   # 引导技能（bootstrap）
│   ├── brainstorming/       # 设计前头脑风暴
│   ├── writing-plans/       # 实现计划编写
│   ├── subagent-driven-development/  # 子代理驱动开发
│   ├── executing-plans/     # 计划执行（同会话）
│   ├── dispatching-parallel-agents/  # 并行代理调度
│   ├── test-driven-development/      # TDD 强制规范
│   ├── systematic-debugging/         # 系统化调试
│   ├── requesting-code-review/       # 代码审查请求
│   ├── receiving-code-review/        # 代码审查响应
│   ├── using-git-worktrees/          # Git worktree 隔离
│   ├── finishing-a-development-branch/  # 分支收尾
│   ├── verification-before-completion/  # 完成前验证
│   └── writing-skills/      # 技能编写方法论
├── scripts/                 # 维护脚本（版本同步、Codex 同步）
├── tests/                   # 集成测试体系
│   ├── claude-code/         # headless Claude Code 会话测试
│   ├── skill-triggering/    # 技能自动触发测试
│   ├── explicit-skill-requests/  # 显式技能请求测试
│   ├── subagent-driven-dev/ # SDD 端到端测试
│   ├── brainstorm-server/   # 零依赖头脑风暴服务测试
│   └── opencode/            # OpenCode 插件测试
├── .version-bump.json       # 声明式版本同步配置
├── CLAUDE.md                # 面向代理的严格纪律手册（94% PR 拒绝率）
├── package.json             # 仅含版本信息，零依赖
└── README.md                # 用户文档
```

**关键架构决策**：
- `skills/` 是 canonical 工作流面，`commands/` 仅作兼容保留
- 所有 durable behavior 放在共享源，harness-specific 文件仅用于加载和适配
- 零依赖设计哲学：package.json 无依赖，所有脚本用纯 bash 编写

---

## 三、核心功能模块

| 模块 | 职责 | gxpm 映射参考 |
|------|------|---------------|
| **using-superpowers** | SessionStart hook 注入，建立指令优先级，强制技能检查规则 | `skills/gxpm/SKILL.md` — 引导技能 |
| **工作流编排技能链** | 状态机式开发流程：brainstorming → worktree → plan → implement → review → verify | gxpm phase gate（triage→plan→dispatch→…→land） |
| **subagent-driven-development** | 每个任务派发给新子代理，两阶段审查（spec compliance + code quality） | `gxpm-explore-codebase` / `gxpm-review-changes` 可借鉴 |
| **多宿主适配层** | 6 个宿主平台的 manifest + hook 适配 | `hosts/claude.ts`、`hosts/codex.ts` — 适配层设计 |
| **writing-skills** | 将 TDD 原则应用到流程文档：RED（压力测试）→ GREEN（最小 skill）→ REFACTOR（封堵漏洞） | `docs/governance/skill-authoring.md` |

---

## 四、技术栈

- **零依赖**：package.json 无 runtime dependency
- **纯 bash 脚本**：所有维护脚本用 bash 编写
- **Markdown + YAML frontmatter**：所有 skill 逻辑用 Markdown 表达
- **外部工具要求**：`jq`（版本脚本）、`rsync`（同步脚本）、`gh`（GitHub CLI）
- **跨平台 hook**：polyglot `.cmd` wrapper 解决 Windows CMD 兼容

---

## 五、Skill/Plugin/Capability 机制

### 5.1 Skill 格式规范

```markdown
---
name: skill-name-with-hyphens
description: Use when [specific triggering conditions and symptoms]
---
```

- `name`：仅允许字母、数字、连字符
- `description`：必须以 `"Use when..."` 开头，**只描述触发条件，绝不描述工作流程**
- frontmatter 总计 ≤ 1024 字符
- 引导技能 <150 词，高频技能 <200 词，其他 <500 词

### 5.2 发现与加载

依赖宿主平台原生机制：
- Claude Code：`plugin.json` 的 `"skills": ["./skills/"]` 声明，自动扫描 `SKILL.md`
- Codex：`skills` 字段指向 `./skills/` 目录
- OpenCode：JS plugin 在运行时动态 `config.skills.paths.push(superpowersSkillsDir)`

### 5.3 编排机制

**自动触发**（核心模式）：skill 的 description 被设计为强制触发语句（如 "You MUST use this before any creative work..."）

**显式调用**：用户直接请求 "use systematic-debugging"

### 5.4 权限与纪律

- **Instruction Priority**：用户明确指令 > Superpowers skills > 默认系统提示
- **HARD-GATE**：`<HARD-GATE>...</HARD-GATE>` 声明不可逾越的边界
- **Red Flags 表**：列出代理可能绕过规则的合理化思维，并一一驳斥
- **Iron Law**："NO SKILL WITHOUT A FAILING TEST FIRST"

---

## 六、配置系统

### 6.1 版本同步配置（`.version-bump.json`）

声明式版本管理系统：
```json
{
  "files": [
    { "path": "package.json", "field": "version" },
    { "path": ".claude-plugin/plugin.json", "field": "version" },
    { "path": ".codex-plugin/plugin.json", "field": "version" }
  ],
  "audit": { "exclude": ["CHANGELOG.md", ...] }
}
```

- `bump-version.sh --check`：检测版本漂移
- `bump-version.sh --audit`：扫描仓库中未声明的旧版本字符串
- 支持 nested field path

### 6.2 多宿主配置扩展点

每个宿主有独立 manifest 文件，但共享 `skills/` 和 `assets/`：
- `.claude-plugin/plugin.json` — 基础元数据
- `.codex-plugin/plugin.json` — 额外含 interface、defaultPrompt、brandColor
- `.cursor-plugin/plugin.json` — 额外含 agents、commands、hooks 路径

新增宿主 = 新增 manifest 目录 + 适配 hooks/session-start 中的输出格式分支。

---

## 七、对 gxpm 的借鉴价值

### 7.1 可直接复用的模式 ✅

| 模式 | superpowers 实践 | gxpm 应用点 |
|------|------------------|-------------|
| **Skill 描述设计原则** | Description = When to Use, NOT What the Skill Does | gxpm capability/skill 描述应只写触发条件，不写执行流程 |
| **子代理两阶段审查** | Spec compliance review → Code quality review | `verify` phase 可先检查 artifact 合规性，再检查代码质量 |
| **SessionStart Hook 注入** | 引导语注入首条消息，避免系统消息 token 膨胀 | `hosts/claude.ts`、`hosts/codex.ts` 的引导注入逻辑 |
| **TDD 应用于流程文档** | RED（压力测试）→ GREEN（最小 skill）→ REFACTOR（封堵漏洞） | `gxpm-tdd` skill 和 skill authoring 流程建立 eval 体系 |
| **多宿主版本同步** | `.version-bump.json` + `bump-version.sh` | 引入 drift detection 到 `bun run check` |
| **严格治理文档** | CLAUDE.md 作为面向代理的纪律手册 | 强化 `AGENTS.md` 中关于 PR 质量的标准 |

### 7.2 应避免的陷阱 ❌

| 陷阱 | 原因 | gxpm 应对 |
|------|------|-----------|
| **无独立运行时** | 完全依赖宿主平台的 skill 发现机制 | gxpm 必须坚持 `.gxpm/` 本地状态、Linear 集成、phase gate 等运行时基础设施 |
| **零依赖的测试代价** | 集成测试依赖外部 `claude` CLI 命令和 API key，CI 难以稳定运行 | 利用 `bun test` 建立可自动化的单元测试和模拟测试 |
| **纯 Markdown 流程控制** | 决策树、循环、状态转换都写在 Markdown 中，依赖 LLM 遵循能力 | 坚持**代码优先**的流程控制（`core/gate.ts`、`core/dispatch.ts`） |

---

## 八、关键文件映射

| superpowers 文件/模式 | gxpm 对应位置/建议 |
|-----------------------|---------------------|
| `skills/using-superpowers/SKILL.md` | `skills/gxpm/SKILL.md` — 引导技能 |
| `skills/subagent-driven-development/` | `skills/gxpm-explore-codebase/` 可借鉴其两阶段 review |
| `skills/writing-skills/SKILL.md` | `docs/governance/skill-authoring.md` + `skills/gxpm-planning/` |
| `hooks/session-start` | `hosts/claude.ts`、`hosts/codex.ts` — 引导注入逻辑 |
| `.version-bump.json` | 可引入到 `package.json` 或 `bun run check` |
| `tests/skill-triggering/` | 应在 `test/` 下建立 skill eval 框架 |
| `CLAUDE.md` 的 PR 治理 | 强化 `AGENTS.md` 中关于 PR 质量的标准 |

---

## 九、适配建议

1. **Skill 触发优化**：学习 superpowers 的 "description 只写触发条件" 原则，确保 gxpm skills 的 description 精确、症状导向，避免代理只读 description 而不读完整 skill。
2. **子代理审查分离**：在 `verify` phase 引入 spec compliance check（是否按要求实现）与 code quality review（实现是否优雅）的分离。
3. **Host adapter 引导注入**：研究 `hooks/session-start` 的注入位置策略，按宿主优化引导语注入位置（系统消息 vs 首条用户消息）。
4. **版本漂移检测**：引入 `.version-bump.json` 机制，管理 `hosts/`、`skills/`、插件 manifest 的版本同步。
5. **Skill eval 框架**：参考 `tests/skill-triggering/` 和 `tests/explicit-skill-requests/`，为 gxpm skills 建立压力测试和触发测试。

---

## 十、一句话总结

> superpowers 是**当前业界最成熟的代理技能框架之一**，其 skill 设计哲学、子代理编排模式、多宿主适配经验是 gxpm 的**工程实践上游参考**；但 gxpm 作为独立产品，必须坚持 state graph、capability runtime、本地 artifact 管理等运行时基础设施，避免退化为纯文档框架。
