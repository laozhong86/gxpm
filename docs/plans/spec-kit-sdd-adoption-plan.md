# gxpm 引入 Spec-Driven Development 能力实现计划

> 计划日期：2026-05-05
> 依据：`docs/research/spec-kit-study.md`
> 视角：技术架构师，聚焦架构约束与最小安全路径

---

## 一、概述

### 1.1 目标

将 Spec Kit 的 Spec-Driven Development (SDD) 核心能力内化为 gxpm 的第一方能力：
- **宿主适配注册表**：统一抽象 Claude、Codex、Cursor、Kimi 等宿主，消除硬编码适配
- **四层可扩展性栈**：建立 Override > Preset > Extension > Core 的模板/命令优先级解析机制
- **声明式工作流引擎**：将 gxpm 的 phase gate（triage→plan→dispatch→…→land）从硬编码升级为 YAML 声明式状态机
- **SDD 宪法嵌入**：将 Nine Articles 融入 gxpm 开发契约，建立规格优先的执行纪律

### 1.2 范围

| 在范围内 | 不在范围内（非目标） |
|---------|-------------------|
| 宿主抽象层重构（`hosts/` 目录） | 重写完整的 Python CLI（spec-kit 的 specify 命令） |
| 模板系统优先级栈（`skills/`、`templates/`） | 社区扩展市场与目录系统（catalog.community.json） |
| 工作流引擎最小 viable 实现（支持 gxpm phase） | 30+ 宿主的手写适配文件（用代码生成替代） |
| SDD 宪法与 artifact 合同融合 | 文件系统状态机的服务端化/协作化 |
| `*.tmpl` 多宿主渲染管道 | 扩展 ZIP 下载与版本兼容检查（复用现有包管理器） |

### 1.3 成功标准

1. 新增宿主时仅需修改/新增一个声明文件（类似 spec-kit 的集成子包），无需改动核心代码
2. skill 模板支持四层覆盖：项目本地 `.gxpm/local/` > 预设 > 扩展 > 核心 `skills/`
3. gxpm phase 推进可由 YAML 工作流定义驱动，支持暂停/恢复/人工 gate
4. 所有变更不破坏现有 `.gxpm/issues/` 状态机和 `bun test` 测试集

---

## 二、架构约束总览

### 2.1 从 spec-kit 继承的约束（必须遵守）

| 约束 | 说明 | gxpm 应对策略 |
|------|------|--------------|
| **模板运行时解析栈** | Override > Preset > Extension > Core 优先级不可绕过 | `TemplateResolver` 类严格按栈解析，单元测试覆盖优先级冲突 |
| **命令命名空间隔离** | 扩展命令必须遵循 `gxpm.{ext-id}.{cmd}`，不可 shadow core | `CapabilityRegistry` 注册时校验命名空间前缀 |
| **宿主 CLI Key 匹配** | `requires_cli=True` 时 `key` 必须等于可执行文件名 | `HostAdapter` 抽象中保留 `detect()` 方法，使用 `which` 语义 |
| **上下文文件标记** | 使用显式 START/END 标记管理代理目录注入段 | 沿用现有 `<!-- BEGIN GXPM -->` / `<!-- END GXPM -->` 标记规范 |
| **路径逃逸防护** | 所有文件写入必须校验目标路径在允许范围内 | 复用已有路径校验，提取为共享 `safe-path.ts` 工具 |
| **SDD 宪法 Article I-IX** | Library-First、CLI Mandate、Test-First、Simplicity Gate 等 | 写入 `docs/governance/development-contract.md`，作为 skill 生成的前置检查 |

### 2.2 从 spec-kit 规避的约束（主动打破）

| 约束 | spec-kit 现状 | gxpm 规避策略 |
|------|--------------|--------------|
| **同步 I/O 架构** | 全同步阻塞，fan-out 无法并行 | 工作流引擎基于 async/await 构建，步骤可标记 `parallel: true` |
| **单体 CLI 文件** | `__init__.py` 近 6,000 行 | 已是模块化 TypeScript，保持子命令按文件拆分 |
| **无数据库/纯文件状态** | 状态以 JSON 文件落盘 | 保留文件状态机作为默认，但接口抽象允许未来接入 SQLite/KV |
| **单项目隔离** | 产物严格落在 `.specify/` 下 | 支持用户级 `~/.gxpm/` 与项目级 `.gxpm/` 叠加 |
| **手写 30+ 宿主适配** | 每宿主一个子包，重复性声明 | 采用"协议 schema + 代码生成"，宿主差异用 YAML 描述 |

### 2.3 gxpm 自身新增约束

| 约束 | 来源 | 说明 |
|------|------|------|
| **TypeScript 运行时** | 产品定位 | 所有核心引擎代码必须为 TypeScript，禁止引入 Python 运行时依赖 |
| **gxpm issue 状态机兼容** | 现有契约 | 工作流引擎的 step ID 必须能映射到现有 phase（triage/plan/dispatch/…） |
| **Commit 引用规范** | AGENTS.md | 任何代码改动必须关联 `GXPM-N` issue |
| **Worktree 隔离** | `.gxpm/config.json` | 实现阶段默认使用 git worktree，工程变更需在独立 worktree 验证 |

---

## 三、阶段化实施路线

### Phase 1：基础设施与约束层（预计 1 周）

**目标**：建立模板解析栈、路径安全、SDD 契约检查的基础设施。

**交付物**：
1. `core/template-resolver.ts` — 四层优先级模板解析器
   - 接口：`resolve(templateName: string, context: RenderContext): string`
   - 优先级栈：`local/ > presets/<id>/ > extensions/<id>/ > skills/`
   - 支持策略：`replace`（默认）、`prepend`、`append`、`wrap`
2. `core/safe-path.ts` — 路径逃逸防护工具
   - 提取现有路径校验逻辑，统一为 `ensureInside(target: string, allowedRoot: string): void`
   - 替换 `agents.ts`、`extensions.ts`（如有）中的内联校验
3. `core/sdd-gate.ts` — SDD 宪法前置检查
   - 实现 Nine Articles 的自动化检查（如：检测模块数是否超过 Simplicity Gate 阈值）
   - 在 `bun run check` 中新增 `sdd-check` 子任务
4. `docs/governance/development-contract.md` 更新
   - 新增"规格驱动开发"章节，融入 Nine Articles

**验收标准**：
- `bun test` 新增 `template-resolver.test.ts`、`safe-path.test.ts`、`sdd-gate.test.ts`，全部通过
- `bun run check` 包含 sdd-check 且无报错
- 现有技能生成不受破坏（`bun run gen:skill-docs` 输出一致）

**架构约束检查点**：
- [ ] 模板解析栈优先级不可被配置绕过（硬编码为常量）
- [ ] 路径校验覆盖所有文件写入路径（grep `_ensure_inside\|writeFile\|mkdir` 全命中）

---

### Phase 2：宿主抽象注册表（预计 1 周）

**目标**：将 `hosts/claude.ts`、`hosts/codex.ts` 等硬编码适配重构为注册表驱动的声明式系统。

**交付物**：
1. `hosts/registry.ts` — 宿主适配注册表
   - `HostAdapter` 接口：`key`、`name`、`detect(): boolean`、`install(command: CommandDef, path: string): void`、`uninstall(commandName: string): void`
   - `HOST_REGISTRY: Map<string, HostAdapter>`
   - 注册函数：`registerHost(adapter: HostAdapter)`
2. `hosts/adapters/` 目录
   - `claude.ts`：Claude Code 适配（Markdown 命令格式）
   - `codex.ts`：Codex CLI 适配（Skills 格式）
   - `cursor.ts`：Cursor 适配（.cursorrules / 命令格式）
   - `kimi.ts`：Kimi Code CLI 适配（Skills 格式）
   - 每文件 <100 行，仅含适配元数据与格式转换函数
3. `hosts/schema.ts` — 宿主协议 schema
   - 定义 `CommandDef`、`HostConfig`、`OutputFormat` 类型
   - 支持四种格式：markdown、toml、yaml、skills
4. `scripts/gen-host-adapters.ts` — 宿主适配代码生成器（可选，MVP 阶段可手写）
   - 输入：`hosts/adapters/<name>.yaml` 描述文件
   - 输出：`hosts/adapters/<name>.ts` 适配代码

**验收标准**：
- `bun test` 新增 `hosts/registry.test.ts`，验证注册/卸载/检测逻辑
- 现有 `gxpm init` 对 Claude/Codex/Cursor 的初始化行为保持不变（黑盒兼容）
- 新增宿主适配时，仅需新增一个 `<50 行` 的适配文件并在 `hosts/index.ts` 导入

**架构约束检查点**：
- [ ] `requires_cli=true` 的宿主 `key` 与可执行文件名匹配（`detect()` 使用 `which` 语义）
- [ ] 宿主命令安装使用显式 START/END 标记
- [ ] 命令命名空间隔离：宿主级命令前缀为 `/gxpm`，扩展级为 `/gxpm.{ext-id}.{cmd}`

---

### Phase 3：声明式工作流引擎（预计 2 周）

**目标**：将 gxpm phase gate 从硬编码 TypeScript 逻辑升级为 YAML 声明式工作流，支持暂停/恢复/人工 gate。

**交付物**：
1. `core/workflows/` 目录（自治子系统，不依赖扩展/预设逻辑）
   - `engine.ts`：`WorkflowEngine` — 加载、校验、执行、持久化、恢复
   - `definition.ts`：`WorkflowDefinition` — YAML 解析与 schema 校验
   - `state.ts`：`RunState` — 每步后保存到 `.gxpm/workflows/runs/{run_id}/state.json`
   - `context.ts`：`StepContext` — 传递 inputs、steps 结果、变量
2. `core/workflows/steps/` — 内置步骤类型（最小 viable 集）
   - `command.ts` — 调用 gxpm CLI 子命令
   - `shell.ts` — 执行 shell 命令
   - `gate.ts` — 交互式人工审核（阻塞，等待用户输入 y/n）
   - `if_then.ts` — 条件分支
   - `fan_out.ts` / `fan_in.ts` — 集合分发与结果聚合
   - 每步骤继承 `StepBase`，含 `execute()`、`validate()`、`canResume()`
3. `workflows/gxpm-standard.yml` — gxpm 标准工作流定义
   - 将现有 phase gate 映射为步骤序列：`triage → plan → dispatch → implement → verify → qa → land`
   - 每个 phase 对应一个 `command` 步骤：`gxpm issue transition {id} {phase}`
   - `gate` 步骤用于 phase 间的人工确认点
4. `core/workflows/expressions.ts` — Jinja2-like 表达式引擎
   - 最小实现：变量插值 `${var}`、条件表达式 `{% if %}`
   - 上下文：inputs、steps 输出、环境变量

**状态机定义**：

```yaml
schema_version: "1.0"
id: gxpm-standard
name: "GXPM Standard Delivery Workflow"
inputs:
  issue_id: string
  auto_land: boolean
steps:
  - id: triage
    type: command
    config: { command: "gxpm issue transition ${issue_id} triage" }
  - id: plan_gate
    type: gate
    config: { prompt: "计划已就绪，确认进入 dispatch？" }
  - id: dispatch
    type: command
    config: { command: "gxpm issue transition ${issue_id} dispatch" }
  - id: implement
    type: command
    config: { command: "gxpm issue transition ${issue_id} implement" }
  - id: verify
    type: command
    config: { command: "gxpm issue transition ${issue_id} verify" }
  - id: qa_gate
    type: gate
    config: { prompt: "QA 通过，确认进入 land？" }
  - id: land
    type: command
    config: { command: "gxpm issue transition ${issue_id} land" }
```

**验收标准**：
- `bun test` 新增 `workflows/engine.test.ts`，覆盖：
  - 工作流加载与校验
  - 顺序执行与状态持久化
  - gate 步骤暂停与 resume
  - if 条件分支
  - fan-out/fan-in 集合处理
- 现有 `gxpm issue transition` CLI 行为不变
- 工作流运行状态文件 `.gxpm/workflows/runs/{id}/state.json` 可被独立读取恢复

**架构约束检查点**：
- [ ] 步骤 ID 唯一性校验（禁止 `:` 字符）
- [ ] schema_version 严格校验（仅支持 `1.0`，未来升级需显式迁移）
- [ ] Resume 粒度：顶层步骤索引级（与 spec-kit 保持一致，嵌套 resume 标记为 Phase 4 增强）
- [ ] 工作流引擎不依赖扩展/预设子系统（模块边界清晰）

---

### Phase 4：SDD 宪法与 Artifact 合同融合（预计 1 周）

**目标**：将 Spec Kit 的 SDD 方法论嵌入 gxpm artifact 体系，使规格说明成为可执行的主要产物。

**交付物**：
1. `docs/governance/spec-driven-contract.md` — SDD 执行合同
   - 定义规格（spec）、计划（plan）、任务（tasks）三种 artifact 的标准结构
   - 映射到 gxpm 现有 artifact 类型：`triage-report` → spec，`implementation-plan` → plan，`task-list` → tasks
   - 定义 Phase -1 Gates（开发前必须通过的检查清单）
2. `templates/spec-template.md.tmpl` — 规格模板
   - 需求澄清、范围界定、非目标、成功标准、验收条件
3. `templates/plan-template.md.tmpl` — 计划模板
   - 架构决策、风险评估、阶段划分、验证方法
4. `templates/tasks-template.md.tmpl` — 任务模板
   - 垂直切片、独立可抓取、验收标准
5. `core/artifact-validator.ts` — Artifact 结构校验器
   - 校验 spec/plan/tasks 的必要 frontmatter 和章节
   - 在 `gxpm artifact write` 时自动触发

**验收标准**：
- `bun test` 新增 `artifact-validator.test.ts`
- `gxpm issue create --auto-id` 时，若 type 为 feature，自动提示生成 spec artifact
- 现有 artifact 类型不破坏，新增 spec/plan/tasks 为可选增强

**架构约束检查点**：
- [ ] Simplicity Gate：单个 feature 的 spec + plan + tasks 不超过 3 个 artifact 文件
- [ ] Test-First：plan artifact 必须包含测试策略章节
- [ ] Explicit over Implicit：所有假设和依赖必须显式声明

---

### Phase 5：整合与验收（预计 1 周）

**目标**：将前四阶段成果整合为完整用户流程，端到端验证。

**交付物**：
1. `gxpm workflow` 子命令
   - `gxpm workflow list` — 列出可用工作流
   - `gxpm workflow run <workflow-id> --issue <id>` — 运行工作流
   - `gxpm workflow status <run-id>` — 查看运行状态
   - `gxpm workflow resume <run-id>` — 恢复暂停的工作流
2. `gxpm init` 升级
   - 初始化时检测宿主并注册对应适配器
   - 安装标准工作流定义到 `.gxpm/workflows/`
3. 端到端测试（E2E）
   - 模拟完整 issue 生命周期：create → triage → plan → dispatch → implement → land
   - 验证工作流状态机与 `.gxpm/issues/` 状态机的一致性

**验收标准**：
- `bun test` 全量通过（现有 + 新增）
- `bun run check` 通过
- E2E 测试脚本在独立 worktree 中运行成功
- 新增代码行数不超过 3,000 行（Simplicity Gate）

---

## 四、风险与缓解

| 风险 | 可能性 | 影响 | 缓解措施 |
|------|--------|------|---------|
| **工作流引擎过度设计** | 中 | 高 | Phase 3 严格限制为最小 viable 步骤集（5 种），禁止引入循环/并发等复杂特性 |
| **宿主适配破坏现有初始化** | 中 | 高 | Phase 2 保持黑盒兼容，新增适配文件后运行现有 `hosts/*.test.ts` 全量回归 |
| **模板解析栈引入性能退化** | 低 | 中 | 解析结果缓存到 `.gxpm/cache/templates.json`，缓存键为 `templateName + priorityStackHash` |
| **SDD 宪法与现有流程冲突** | 中 | 中 | Phase 4 的 spec/plan/tasks 为可选增强，不强制替换现有 triage-report/implementation-plan |
| **Commit 规模失控** | 低 | 高 | 每 Phase 独立分支（`gxpm-N-sdd-phase-{1-5}`），单 PR 不超过 400 行变更 |

---

## 五、验证方法

1. **单元测试**：每阶段新增测试文件，覆盖率目标 >80%
2. **回归测试**：`bun test` 全量通过，现有测试零破坏
3. **集成测试**：在独立 worktree 中运行 `gxpm init` + `gxpm workflow run` 完整流程
4. **静态检查**：`bun run check` 通过（类型检查 + lint）
5. **架构约束检查**：每阶段结束时运行自定义脚本验证约束检查点
6. **代码规模检查**：`find src/core/workflows -name '*.ts' | xargs wc -l` 确认引擎代码 <1,500 行

---

## 六、附录：与 gxpm 现有能力的整合矩阵

| gxpm 现有能力 | 本计划增强点 | 文件映射 |
|--------------|-------------|---------|
| `skills/gxpm/SKILL.md` | 引入 SDD 宪法章节 | `templates/spec-template.md.tmpl` |
| `hosts/claude.ts` | 重构为 `hosts/adapters/claude.ts` | `hosts/registry.ts` |
| `core/config.ts` | 增加模板解析配置 | `core/template-resolver.ts` |
| `core/dag-executor.ts` | 工作流引擎可复用 DAG 执行经验 | `core/workflows/engine.ts` |
| `.gxpm/issues/<id>/` | 工作流 run state 并存于 `.gxpm/workflows/runs/` | `core/workflows/state.ts` |
| `bun run gen:skill-docs` | 支持 `--host all` 批量生成 | `hosts/registry.ts` 遍历注册表 |

---

*本计划遵循 gxpm 开发契约：任何代码改动开始前，确认有对应 GXPM-N issue 处于 dispatch/implement 阶段。*
