# Spec Kit 深度架构研究报告

> 研究日期：2026-05-05
> 来源：GitHub 官方开源项目 `spec-kit`（本地路径 `/Users/x/Desktop/Project/github/spec-kit`）
> 研究目的：从技术架构师视角分析 Spec-Driven Development 工具链的架构约束，为 gxpm 引入规格驱动开发能力提供决策依据

---

## 一、项目定位

**Spec Kit** 是 GitHub 官方开源的 **Spec-Driven Development (SDD)** 工具包与 CLI。其核心主张是将软件规格说明（Specification）提升为**可执行的主要产物**，而非代码的附属文档。

产品形态：
- `specify` CLI（Python，Typer 框架）
- 模板系统（Markdown/TOML/YAML 命令模板）
- 工作流引擎（YAML 驱动，10 种步骤类型）
- 扩展/预设双系统（第三方能力接入与行为定制）
- 30+ AI 编码助手集成（Claude Code、Codex、Kimi、Cursor 等）

---

## 二、架构概览

### 2.1 目录结构

```
spec-kit/
├── src/specify_cli/           # CLI 核心源码（~14.8k 行 Python）
│   ├── __init__.py            # 主 CLI 入口（5,869 行，含所有子命令）
│   ├── agents.py              # CommandRegistrar：命令注册与多代理格式渲染
│   ├── extensions.py          # ExtensionManager：扩展生命周期管理
│   ├── presets.py             # PresetManager：预设生命周期与模板解析
│   ├── integrations/          # AI 助手集成抽象层（30+ 个）
│   │   ├── base.py            # IntegrationBase 及四大子类抽象
│   │   └── <agent>/           # 每助手一个子包（claude/、gemini/、kimi/ 等）
│   └── workflows/             # 工作流引擎
│       ├── engine.py          # WorkflowDefinition、WorkflowEngine、RunState
│       ├── expressions.py     # Jinja2-like 表达式求值
│       └── steps/             # 10 种内置步骤（command/shell/prompt/gate/if/…）
├── templates/                 # 核心页面模板与命令模板
├── scripts/                   # Bash/PowerShell 辅助脚本
├── extensions/                # 扩展系统文档与内置 git 扩展
├── presets/                   # 预设系统文档与内置预设
├── tests/                     # ~25.7k 行测试代码（61 个文件）
└── docs/                      # DocFx 文档站点
```

### 2.2 技术栈

| 层级 | 技术 |
|------|------|
| 语言 | Python 3.11+ |
| CLI | Typer（Click） |
| 构建 | Hatchling |
| TUI | Rich |
| 配置 | PyYAML、json5 |
| 版本兼容 | `packaging.SpecifierSet` |
| 路径规则 | `pathspec`（.gitignore 语义） |
| 测试 | pytest + pytest-cov |
| Lint | ruff |
| CI/CD | GitHub Actions |

---

## 三、核心抽象与概念模型

### 3.1 四层可扩展性栈（优先级从高到低）

| 层级 | 路径 | 作用 |
|------|------|------|
| 1. Project-Local Overrides | `.specify/templates/overrides/` | 一次性本地调整 |
| 2. Presets | `.specify/presets/<id>/` | 可共享、可堆叠的模板/命令/脚本覆盖 |
| 3. Extensions | `.specify/extensions/<id>/` | 新增能力与外部工具集成 |
| 4. Core | `.specify/templates/` | 内置默认模板 |

**关键设计**：Templates 在**运行时**解析（走优先级栈），而 Extension/Preset 的 commands 在**安装时**写入代理目录。

### 3.2 集成抽象（Integration Registry）

所有 AI 助手通过 `IntegrationBase` 注册到全局 `INTEGRATION_REGISTRY`：

- `IntegrationBase` — 抽象基类，定义 `key`、`config`、`setup()`、`teardown()`
- `MarkdownIntegration` — `.md` 命令格式，覆盖 ~20 个代理
- `TomlIntegration` — `.toml` 格式，用于 Gemini、Tabnine
- `YamlIntegration` — YAML recipe，用于 Goose
- `SkillsIntegration` — `SKILL.md` 目录布局，用于 Codex、Kimi 等

**设计约束**：CLI 型集成（`requires_cli: True`）的 `key` 必须与实际可执行文件名匹配，以便 `shutil.which(key)` 检测。

### 3.3 工作流引擎

状态机驱动的执行引擎：

```
CREATED → RUNNING → [COMPLETED | PAUSED | FAILED | ABORTED]
            ↑___________|
```

- `WorkflowDefinition`：从 YAML 解析（id/name/version/inputs/steps）
- `WorkflowEngine`：加载 → 校验 → 执行 → 持久化 → 恢复
- `RunState`：每步后保存到 `.specify/workflows/runs/{run_id}/state.json`
- `StepContext`：传递 inputs、steps 结果、item、fan_in 等上下文

10 种内置步骤：command、shell、prompt、gate、if_then、switch、while_loop、do_while、fan_out、fan_in。

### 3.4 扩展与预设生命周期

| 组件 | 核心类 | 注册表 |
|------|--------|--------|
| 扩展 | `ExtensionManager`、`ExtensionManifest` | `.specify/extensions/.registry` |
| 预设 | `PresetManager`、`PresetManifest` | `.specify/presets/.registry` |

两者均支持：
- 目录系统（`catalog.json` + `catalog.community.json`）
- ZIP 下载安装、版本兼容性检查（PEP 440）
- 命令注册到代理目录、卸载时清理
- 技能模式（`--ai-skills`）下生成 `SKILL.md`

---

## 四、架构约束（显式与隐式）

### 4.1 显式约束

| 约束 | 来源 | 说明 |
|------|------|------|
| Python >= 3.11 | `pyproject.toml` | 现代语法依赖 |
| 模板运行时解析栈 | `presets/ARCHITECTURE.md` | Override > Preset > Extension > Core，不可绕过 |
| 命令命名空间 | `extensions.py` | 扩展命令必须遵循 `speckit.{ext-id}.{cmd}`，不可 shadow core |
| 语义版本 | Manifest | PEP 440，`SpecifierSet` 校验 |
| 预设组合策略 | `presets.py` | 仅 replace/prepend/append/wrap 四种；script 仅 replace/wrap |
| 工作流 schema_version | `engine.py` | 仅支持 `1.0` |
| 步骤 ID 唯一性 | `engine.py` | 不允许 `:` 字符（保留给引擎嵌套 ID） |
| Agent CLI Key 匹配 | `AGENTS.md` | `requires_cli=True` 时 `key` 必须等于可执行文件名 |
| 上下文文件标记 | `base.py` | `<!-- SPECKIT START -->` / `<!-- SPECKIT END -->` 管理注入段 |
| 路径逃逸防护 | `agents.py`、`extensions.py` | 所有写入通过 `_ensure_inside()` 校验 |

### 4.2 隐式约束

| 约束 | 推断依据 | 架构影响 |
|------|---------|---------|
| **单例注册表模式** | `INTEGRATION_REGISTRY`、`STEP_REGISTRY` 为全局字典 | 不支持动态卸载；扩展新步骤需修改源码并重启 |
| **同步 I/O 为主** | `subprocess.run`、文件读写均为同步阻塞 | 工作流 fan-out 实际顺序执行；无法利用异步并发 |
| **无数据库/无服务器** | 所有状态以 JSON/YAML 文件落盘 | 适合本地 CLI，无法天然支持多机协作或服务化 |
| **Template-First 设计** | 核心逻辑依赖 Markdown 模板占位符替换 | 复杂条件逻辑难以在模板中表达，必须下沉到 Python/shell |
| **单项目隔离** | 所有产物落在 `.specify/` 目录下 | 不支持跨项目复用配置（除非通过 `~/.specify/`） |
| **代理目录耦合** | 安装时直接写入 `.claude/commands/` 等 | 代理升级或目录结构变更会导致不兼容 |
| **无网络服务治理** | 扩展下载直接拉取 GitHub raw/ZIP | 无镜像、无缓存失效策略、无重试机制 |
| **强一致性文件状态假设** | 注册表、manifest、模板文件必须同时一致 | 手动修改 `.specify/` 易导致状态不一致 |

### 4.3 宪法级约束（SDD 方法论）

`spec-driven.md` 中阐述的 **Nine Articles of Development**：

1. **Library-First**：每个特性必须先以独立库形式存在
2. **CLI Interface Mandate**：所有库必须暴露 CLI（stdin/stdout，支持 JSON）
3. **Test-First Imperative**：严格 TDD，红-绿-重构
4. **Composition over Inheritance**：优先组合
5. **Explicit over Implicit**：显式优于隐式
6. **Fail Fast, Fail Loud**：快速失败、大声失败
7. **Simplicity Gate**：最多 3 个项目/模块
8. **Anti-Abstraction**：直接使用框架特性，禁止过度包装
9. **Integration-First Testing**：优先使用真实环境而非 mock

这些约束通过模板中的 Phase -1 Gates 强制执行，是 Spec Kit 生成代码的元级约束。

---

## 五、模块耦合分析

### 5.1 高耦合点

1. **`presets.py` ↔ `extensions.py`**：预设命令注册时需检查扩展是否已安装；预设卸载后需调和技能目录。
2. **`agents.py` ↔ `integrations/base.py`**：`CommandRegistrar` 的 `AGENT_CONFIGS` 在运行时从 `INTEGRATION_REGISTRY` 派生，存在循环导入风险（通过懒加载和 `try/except ImportError` 处理）。
3. **`__init__.py` ↔ 所有子模块`**：主 CLI 文件导入并委托给各子模块，形成事实上的 Facade，但单文件膨胀至近 6,000 行。

### 5.2 低耦合点

- `workflows/` 子系统几乎独立于扩展/预设系统
- `integrations/` 子包之间完全独立（每代理一个文件，通常 <30 行）

---

## 六、限制与风险

### 6.1 显式文档化的限制

1. **Resume 粒度限制**：嵌套步骤（`if`/`switch`/`while` 内）暂停后，resume 会重新运行父控制流步骤及其嵌套体。精确 resume（嵌套步骤路径栈）是计划中的增强。
2. **Requirements 未强制**：`engine.py` 中声明但未在运行时强制。
3. **Windows Bash 测试跳过**：`test.yml` 中注明，无 MSYS2/MINGW 时 bash 测试自动跳过。

### 6.2 代码推断的限制

1. **单体 CLI 文件膨胀**：`__init__.py` 近 6,000 行，未按子命令拆分。
2. **同步架构天花板**：所有 I/O 同步，fan-out 无真正并行。
3. **模板表达能力受限**：复杂逻辑无法在 Markdown 模板中表达。
4. **多代理维护负担**：30+ 集成子包大部分为 10-30 行重复声明，代理格式变更需逐一手动更新。
5. **扩展生态信任模型**：社区扩展采用策展而非代码审计模型，官方声明不审查扩展代码本身。
6. **无内置迁移/升级工具**：`specify upgrade` 依赖 git 拉取，对非 git 或已重度定制项目的升级策略不明确。

---

## 七、对 gxpm 的映射参考

| Spec Kit 能力 | gxpm 映射参考 | 借鉴优先级 |
|--------------|--------------|-----------|
| **SDD 宪法（Nine Articles）** | `docs/governance/development-contract.md` 可引入规格驱动开发章节 | 高 |
| **四层可扩展性栈** | gxpm 的 `skills/` + `templates/` + `.gxpm/local/` 可对标为 Override/Preset/Extension/Core | 高 |
| **工作流引擎** | gxpm 当前 phase gate（triage→plan→dispatch→…→land）可升级为 YAML 可声明的状态机 | 中 |
| **Integration Registry** | `hosts/claude.ts`、`hosts/codex.ts` 可升级为统一的宿主适配注册表 | 高 |
| **模板运行时解析** | skill 的 `*.tmpl` 生成机制可借鉴优先级栈覆盖逻辑 | 中 |
| **扩展/预设目录系统** | gxpm 的 capability runtime 可引入社区扩展目录与版本兼容检查 | 低 |
| **SKILL.md 生成模式** | 已有 `bun run gen:skill-docs`，可引入 `--ai-skills` 多宿主批量生成 | 中 |
| **工作流 Resume 机制** | gxpm 的 checkpoint/execution continuity 可借鉴状态持久化与恢复模型 | 中 |

---

## 八、关键结论

1. **Spec Kit 的核心价值不是代码，是方法论**：SDD 宪法和四层可扩展性栈是最大资产，工作流引擎和模板系统是实现载体。
2. **同步+文件系统状态机是天花板也是护城河**：适合本地 CLI 场景，但服务化/协作化需要重构核心引擎。
3. **30+ 宿主集成的维护模式不可复制**：gxpm 应采用"协议抽象+代码生成"而非"手写 30 个适配文件"。
4. **扩展/预设双系统提供了清晰的定制边界**：Override > Preset > Extension > Core 的优先级栈可直接借鉴到 gxpm 的 skill/template 系统。
5. **工作流引擎的 resume 和 gate 步骤与 gxpm 的 phase gate 天然互补**：可将 gxpm 的 phase 推进逻辑从硬编码 TypeScript 升级为声明式 YAML 工作流。
