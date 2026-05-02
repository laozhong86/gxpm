# mattpocock-skills 工程实践研究报告

> 研究日期：2026-05-02
> 来源：mattpocock/skills（本地路径 `/Users/x/Desktop/Project/github/mattpocock-skills`）
> 研究目的：提取对 gxpm 有参考价值的工程实践，建立快速适配索引
> 关联文档：`docs/research/mattpocock-skills-comparison.md`（已有对标分析）

---

## 一、项目定位

**mattpocock-skills** 是一个**纯 Markdown + Shell 的技能仓库**，无 package.json，不依赖 Node.js 运行时。所有技能都是面向 Claude Code 的 prompt 指令集合，通过 `.claude-plugin/plugin.json` 声明可被 Claude CLI 发现。

核心定位：面向软件交付生命周期的**工作流技能集合**，按 issue tracker 驱动的工程流程组织（需求对齐 → 计划产出 → 任务拆解 → 问题流转 → 开发实施 → 故障排查）。

---

## 二、架构与目录结构

```
mattpocock-skills/
├── README.md              # 技能总览 + 使用哲学
├── CONTEXT.md             # 领域词汇表（issue tracker, triage role 等）
├── CLAUDE.md              # 仓库内部治理规则
├── docs/adr/              # 架构决策记录（仅 1 条 ADR）
├── .claude-plugin/
│   └── plugin.json        # 暴露给 Claude CLI 的技能清单（12 个技能）
├── scripts/
│   ├── list-skills.sh     # 枚举所有 SKILL.md
│   └── link-skills.sh     # 将技能软链到 ~/.claude/skills
├── skills/
│   ├── engineering/       # 9 个日常工程技能
│   ├── productivity/      # 3 个通用工作流技能
│   ├── misc/              # 4 个低频工具
│   ├── personal/          # 2 个个人专用（不在 README/plugin 中曝光）
│   └── deprecated/        # 4 个已弃用技能
└── .out-of-scope/         # 反需求知识库（3 个拒绝项记录）
```

**关键治理规则（`CLAUDE.md`）**：
- `engineering/`、`productivity/`、`misc/` 中的技能必须在根级 `README.md` 和 `plugin.json` 中登记
- `personal/` 和 `deprecated/` **严禁**出现在 README/plugin 中
- 每个 bucket 目录有自己的 `README.md`，列出该 bucket 内所有技能的一行描述

---

## 三、核心功能模块

项目按**软件交付生命周期**组织技能，职责边界极其清晰：

| 阶段 | 技能 | 职责 |
|------|------|------|
| **初始化** | `setup-matt-pocock-skills` | 种子配置：issue tracker 类型、triage label 映射、domain doc 布局 |
| **需求对齐** | `grill-me` / `grill-with-docs` | 通过"拷问式访谈"消解需求歧义；`grill-with-docs` 额外维护 `CONTEXT.md` 和 ADR |
| **计划产出** | `to-prd` | 将对话上下文合成为 PRD，发布到 issue tracker |
| **任务拆解** | `to-issues` | 将 PRD/计划拆分为 tracer-bullet 垂直切片（Vertical Slices） |
| **问题流转** | `triage` | 状态机驱动的 issue 分类：5 个 state role + 2 个 category role |
| **开发实施** | `tdd` | 红-绿-重构循环，强制"一个测试 → 一个实现"的垂直切片 |
| **故障排查** | `diagnose` | 6 阶段诊断法：构建反馈循环 → 复现 → 假设 → 探测 → 修复 → 事后分析 |
| **架构治理** | `improve-codebase-architecture` | 基于 `CONTEXT.md` + ADR 持续发现"深度模块"重构机会 |
| **代码理解** | `zoom-out` | 轻量提示：要求 Agent 使用领域词汇给出高层模块地图 |

**设计哲学**：每个技能只做一件事，技能之间通过**文档真值（`CONTEXT.md`、ADR、配置）**间接协作，而非直接调用。

---

## 四、技术栈

- **纯 Markdown**：所有 skill 逻辑用 Markdown 表达
- **YAML frontmatter**：skill 元数据（name、description、disable-model-invocation）
- **Shell 脚本**：辅助工具（list-skills.sh、link-skills.sh）
- **无 package.json**：零 Node.js 依赖
- **无 CI/CD**：无自动化测试基础设施

---

## 五、Skill 结构定义

### 5.1 文件结构规范

```
skill-name/
├── SKILL.md           # 主指令（必需）
├── REFERENCE.md       # 详细参考（可选，当 SKILL.md 超过 100 行时拆分）
├── EXAMPLES.md        # 用例示例（可选）
├── AGENT-BRIEF.md     # 专用模板（如 triage）
├── OUT-OF-SCOPE.md    # 知识库规范（如 triage）
├── CONTEXT-FORMAT.md  # 上下文格式规范（如 grill-with-docs）
└── scripts/           # 确定性工具脚本（可选）
    └── helper.sh
```

### 5.2 Frontmatter 规范

```yaml
---
name: skill-name
description: Brief description of capability. Use when [specific triggers].
disable-model-invocation: true   # 可选，仅作为提示，不调用模型
---
```

### 5.3 Description 字段契约

- **硬限制**：≤ 1024 字符
- **视角**：第三人称
- **格式**：第一句讲能力，第二句以 `"Use when..."` 给出触发条件
- **重要性**：`description` 是 Agent 选择加载哪个 skill 的**唯一信息源**

### 5.4 内容组织原则

| 原则 | 说明 |
|------|------|
| **Progressive Disclosure** | SKILL.md 保持精简（目标 <100 行），高级内容拆分到 REFERENCE.md |
| **确定性脚本外置** | 验证、格式化等确定性操作写为脚本，节省 token 并提升可靠性 |
| **具体示例优先** | 禁止空泛描述，必须包含 Good/Bad 对比示例 |
| **无时效信息** | 禁止包含版本号、时间等易过期内容 |

### 5.5 对比 gxpm 现状

gxpm 的 skill 结构（`skills/gxpm-*/SKILL.md`）已经高度遵循此模式，且增加了 `.tmpl` 源文件 + `gen:skill-docs` 生成管道，这是 mattpocock-skills 所没有的**工程化增强**。

---

## 六、Skill 的测试与验证机制

### 6.1 现状：无自动化测试基础设施

mattpocock-skills **没有**测试目录、没有 CI 配置、没有自动化验证管道。Skill 的质量保障依赖：

1. **Review Checklist**（`write-a-skill/SKILL.md` 末尾）：
   - Description 包含触发条件（"Use when..."）
   - SKILL.md < 100 行
   - 无时效敏感信息
   - 术语一致
   - 包含具体示例
   - 引用仅一层深度

2. **Deprecated 目录作为迭代证据**：弃用技能不删除，移入 `deprecated/`，保留历史决策痕迹。

3. **使用反馈驱动**：通过 newsletter 和实际工程使用发现问题。

### 6.2 诊断技能的"反馈循环"哲学

虽然 skill 本身无测试，但 `diagnose` skill 将**"构建快速反馈循环"**提升为调试的第一性原理：

> "If you have a fast, deterministic, agent-runnable pass/fail signal for the bug, you will find the cause... If you don't have one, no amount of staring at code will save you."

`tdd` skill 同样将测试视为**行为契约**而非实现验证。

---

## 七、配置系统与扩展点

### 7.1 核心设计：Per-Repo 配置种子

`setup-matt-pocock-skills` 是一个**prompt-driven 的配置生成器**（非确定性脚本），产出以下真值文件：

```
docs/agents/
├── issue-tracker.md     # GitHub / GitLab / Local / Other
├── triage-labels.md     # 5 个 canonical role → 实际 label 字符串映射
└── domain.md            # 单上下文 vs 多上下文布局规则
```

并在 `AGENTS.md` 或 `CLAUDE.md` 中注入 `## Agent skills` 块。

### 7.2 硬依赖 vs 软依赖分离（ADR-0001）

| 类型 | 技能 | 策略 |
|------|------|------|
| **Hard dependency** | `to-issues`, `to-prd`, `triage` | 必须显式提示：*"run `/setup-matt-pocock-skills` if not"*。没有配置则输出错误。 |
| **Soft dependency** | `diagnose`, `tdd`, `improve-codebase-architecture`, `zoom-out` | 模糊引用"domain glossary"和"ADRs"。无配置时优雅降级，输出只是不够精准。 |

**设计意图**：避免在不需要的地方 cargo-cult 配置指针，保持软依赖技能的 token 轻量。

### 7.3 Issue Tracker 抽象

支持四级后端：
- **GitHub**（`gh` CLI）
- **GitLab**（`glab` CLI）
- **Local markdown**（`.scratch/<feature>/`）
- **Other**（自由文本，由用户自行描述工作流）

### 7.4 领域文档布局

- **Single-context**：根级 `CONTEXT.md` + `docs/adr/`
- **Multi-context**：根级 `CONTEXT-MAP.md` 指向多个子上下文（如 monorepo）

### 7.5 反需求知识库：`.out-of-scope/`

- 一概念一文件（kebab-case 命名）
- 格式：决策、理由、先例请求列表
- 在 `triage` 阶段自动匹配，避免重复讨论已拒绝的特性
- 仅用于 enhancement 的 `wontfix`，不用于 bug

### 7.6 Agent Brief 模板

当 issue 进入 `ready-for-agent` 时，`triage` 要求发布结构化评论：
- **Durability over precision**：只描述接口/行为/类型，不引用文件路径或行号
- **Behavioral, not procedural**：描述"系统应该做什么"，而非"如何修改"
- **Explicit scope boundaries**：明确列出 Out of scope

---

## 八、对 gxpm 的借鉴价值

### 8.1 可直接复用的模式 ✅

| 模式 | 来源文件 | gxpm 应用建议 |
|------|----------|---------------|
| **硬/软依赖分离** | `docs/adr/0001-explicit-setup-pointer-only-for-hard-dependencies.md` | `gxpm-init` 应明确区分哪些技能/phase 必须预配置，哪些可优雅降级 |
| **Agent Brief 契约** | `skills/engineering/triage/AGENT-BRIEF.md` | `dispatch` phase 产出的 artifact 可直接采用：行为描述 + 关键接口 + 验收标准 + 范围边界，禁止文件路径/行号 |
| **`.out-of-scope/` 反需求库** | `skills/engineering/triage/OUT-OF-SCOPE.md` | gxpm 已有 `.gxpm/out-of-scope/`（目前为空），可采纳"一概念一文件 + 先例请求列表 + triage 自动匹配"的完整规范 |
| **垂直切片（Tracer Bullet）** | `skills/engineering/to-issues/SKILL.md` | `gxpm-planning` skill 拆解 issue 时已使用 vertical slice，可进一步引入 HITL vs AFK 分类和显式依赖图 |
| **诊断反馈循环优先** | `skills/engineering/diagnose/SKILL.md` | `gxpm-diagnose` skill 可将 Phase 1（构建反馈循环）作为核心框架 |
| **Disable-model-invocation 轻量技能** | `skills/engineering/zoom-out/SKILL.md` | 对于纯提示类技能（如 `gxpm-grill` 的某些模式），可加 `disable-model-invocation: true` |
| **Issue tracker CLI 抽象** | `skills/engineering/setup-matt-pocock-skills/issue-tracker-*.md` | gxpm 的 Linear/GitHub 集成不应硬编码 CLI，而应通过配置抽象，支持"本地 markdown"作为 fallback |

### 8.2 应避免的陷阱 ❌

| 陷阱 | mattpocock-skills 现状 | gxpm 应如何超越 |
|------|------------------------|-----------------|
| **无自动化验证** | Skill 质量仅靠人工 review checklist 保障 | gxpm 应为 skill 建立**自动化 lint/检查**（如 `bun run check`）、甚至 eval 测试 |
| **无类型安全** | 纯 Markdown frontmatter，无 schema 校验 | gxpm 使用 TypeScript 运行时，skill 元数据应通过 Zod 等 schema 校验 |
| **版本与迁移缺失** | 弃用技能仅移入 `deprecated/` 目录，无迁移指南 | 应建立 skill 版本契约和 deprecation 策略（如 `DEPRECATED.md` + 自动迁移提示） |
| **配置重复提示** | 每个硬依赖技能都重复同样的 setup 提示语 | 可通过 host hook 或 capability runtime 在 session 启动时统一注入配置状态 |
| **无状态机持久化** | triage 状态依赖 issue tracker label，无本地状态图 | gxpm 的核心优势正是**统一 state graph**（`.gxpm/issues/<id>/`），应继续强化 |
| **Plugin.json 静态注册** | `.claude-plugin/plugin.json` 是静态清单 | gxpm 的 skill 注册应支持动态发现（`discover-skills`），与 host adapter 解耦 |

---

## 九、关键差异提醒

mattpocock-skills 是**Claude Code 的纯 prompt skill 集合**，没有自己的运行时、状态图或 capability 系统。gxpm 是**独立产品**，具备：
- TypeScript 运行时 + state graph
- `.gxpm/` 本地真值目录
- Capability runtime + browser evidence
- Review/ship governance

因此，gxpm 不应模仿其"无测试、无类型"的轻量模式，而应**吸收其 workflow 设计、文档治理和 skill 结构规范**，同时在工程化、自动化验证和状态持久化上建立更高标准。

---

## 十、关键文件映射

| mattpocock-skills 文件/模式 | gxpm 对应位置/建议 |
|----------------------------|---------------------|
| `CONTEXT.md` | 已存在，继续作为领域词汇单一真相源 |
| `docs/adr/0001-explicit-setup-pointer-only-for-hard-dependencies.md` | `docs/architecture/` 下记录 gxpm 的硬/软依赖决策 |
| `skills/engineering/triage/AGENT-BRIEF.md` | `core/dispatch.ts` + artifact 模板 |
| `skills/engineering/triage/OUT-OF-SCOPE.md` | `.gxpm/out-of-scope/` 规范化 |
| `skills/engineering/to-issues/SKILL.md` | `skills/gxpm-planning/SKILL.md` |
| `skills/engineering/diagnose/SKILL.md` | `skills/gxpm-diagnose/SKILL.md` |
| `skills/engineering/tdd/SKILL.md` | `skills/gxpm-tdd/SKILL.md` |
| `skills/engineering/write-a-skill/SKILL.md` | `docs/governance/skill-authoring.md` |
| `.out-of-scope/` | `.gxpm/out-of-scope/` 待填充 |
| `deprecated/` | 未来 skill 淘汰机制参考 |

---

## 十一、适配建议

1. **硬/软依赖分离**：在 `gxpm-init` 和 `AGENTS.md` 中明确标记哪些能力是 hard dependency（必须 setup 后才能使用，如 issue tracker 配置），哪些是 soft dependency（无配置时优雅降级，如 `gxpm-diagnose`）。
2. **Agent Brief 模板**：`dispatch` phase 产出的 artifact 采用 Agent Brief 格式——只描述接口/行为/类型，不引用文件路径或行号，明确 scope boundaries。
3. **`.out-of-scope/` 规范化**：将 `.gxpm/out-of-scope/` 从空目录升级为"一概念一文件"的反需求知识库，在 `gxpm-triage` 中自动匹配，避免重复讨论已拒绝的特性。
4. **Skill 自动化验证**：为 gxpm skills 建立自动化 lint（description 长度、frontmatter 完整性、术语一致性）和 eval 测试框架，超越 mattpocock-skills 的人工 review checklist。
5. **Issue Tracker 抽象**：当前 gxpm 硬绑定 Linear，应参考 mattpocock-skills 的抽象层设计，支持本地 markdown fallback（`.gxpm/issues/<id>/` 本身就是本地真值，可作为独立后端）。
6. **垂直切片强化**：`gxpm-planning` skill 在拆解 issue 时，引入 tracer-bullet 垂直切片 + HITL vs AFK 分类 + 显式依赖图。

---

## 十二、一句话总结

> mattpocock-skills 是 gxpm 在**工作流设计、领域文档治理、skill 契约规范**方面的优秀上游参考。gxpm 已大量吸收其术语和结构（`CONTEXT.md`、triage role、vertical slice），下一步应重点补齐其短板：**skill 自动化验证、类型安全 schema、状态机持久化、以及硬/软依赖的 runtime 级管理**。
