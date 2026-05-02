# everything-claude-code 工程实践研究报告

> 研究日期：2026-05-02
> 来源：affaan-m/everything-claude-code（本地路径 `/Users/x/Desktop/Project/github/everything-claude-code`）
> 研究目的：提取对 gxpm 有参考价值的工程实践，建立快速适配索引

---

## 一、项目定位

**everything-claude-code（ECC）** 是一个经过 10+ 个月生产验证、拥有 170+ 贡献者的多 harness（Claude Code / Codex / Cursor / OpenCode / Gemini）代理能力插件包。

核心定位：**Skill 作为最可移植单元的扩展生态**，通过 Manifest 驱动的选择性安装与生命周期管理，为不同宿主平台提供统一的代理能力增强。

ECC 不是独立运行时，而是**共享源 + 适配层**的架构模式：durable behavior 放在共享源，harness-specific 文件仅用于加载和适配。

---

## 二、架构与目录结构

```
everything-claude-code/
├── .claude-plugin/          # Claude Code 插件元数据（plugin.json + marketplace.json）
├── .codex/                  # Codex 适配：config.toml、agents/、AGENTS.md 补充
├── .cursor/                 # Cursor 适配：hooks/（含 adapter.js）、rules/、agents/
├── .opencode/               # OpenCode 适配：instructions/、tools/、README
├── skills/                  # 182 个 SKILL.md（共享源，最可移植单元）
├── agents/                  # 48 个 Markdown agent 定义（YAML frontmatter）
├── commands/                # 68 个 legacy slash 命令（兼容面，逐步迁移至 skills）
├── rules/                   # 分层规则：common/ + typescript/ + python/ + golang/ + ...
├── hooks/                   # 事件驱动自动化（hooks.json + scripts/hooks/）
├── scripts/                 # 跨平台 Node.js 工具库（安装、生命周期、hook 实现）
├── manifests/               # 选择性安装 manifest（install-modules.json / profiles.json）
├── schemas/                 # JSON Schema 校验
├── contexts/                # 动态系统提示注入（dev / review / research）
├── mcp-configs/             # MCP 服务器配置
├── ecc2/                    # Rust 控制平面原型（alpha，TUI dashboard + SQLite state）
└── tests/                   # 997+ 内部测试
```

**核心架构决策**：
- `skills/` 是 canonical 工作流面，`commands/` 仅作兼容保留
- AGENTS.md 是跨工具的通用上下文文件
- 新增宿主 = 新增 manifest 目录 + adapter 层，避免为每个 host 维护完整副本

---

## 三、核心功能模块

| 模块 | 职责 | gxpm 映射参考 |
|------|------|---------------|
| **Skills** | 知识/工作流模块，被动上下文激活 | gxpm skills（当前已对齐 SKILL.md 格式） |
| **Agents** | 专项子代理（planner、code-reviewer 等），显式委派 | gxpm 暂无原生 agent 定义层，值得参考 |
| **Commands** | 用户主动调用的 slash 命令（如 `/plan`） | gxpm CLI 命令（`gxpm issue` 系列） |
| **Rules** | 始终生效的约束指南（分层：通用 + 语言） | `docs/governance/` 的规范化表达 |
| **Hooks** | 事件触发自动化（PreToolUse / PostToolUse / Stop 等） | `.githooks/` + host hook 概念 |
| **Contexts** | 动态系统提示注入模式 | session hook 的 context injection |
| **MCP Configs** | 外部工具集成配置 | MCP 集成参考 |
| **Install System** | 选择性安装、生命周期管理、状态持久化 | **gxpm 最需要借鉴的领域** |
| **ecc2 (Rust)** | 控制平面原型：TUI、SQLite state、session 管理 | gxpm 未来原生运行时可参考 |

---

## 四、技术栈

- **Node.js + TypeScript**：主运行时与脚本库
- **Rust**（ecc2）：控制平面原型（TUI dashboard + SQLite state）
- **JSON Schema**：manifest 和配置校验
- **纯 Markdown**：skills、agents、rules 的内容层
- **跨平台 shell + Node.js**：安装脚本和 hook 实现

---

## 五、扩展生态组织方式

### 5.1 跨 Harness 适配模式

```
共享源                    适配层
skills/*/SKILL.md   →   Claude plugin / Codex auto-load / Cursor copies / OpenCode plugin
rules/              →   Claude rules install / Codex AGENTS.md / Cursor rules / OpenCode instructions
hooks/              →   Claude native / OpenCode plugin events / Cursor adapter.js
agents/*.md         →   Claude agents / Codex agents/*.toml / Cursor ecc-*.md
```

**Cursor Hook Adapter** 是关键工程实践：
- `.cursor/hooks/adapter.js` 将 Cursor 的 stdin JSON 转换为 Claude Code hook 格式
- 复用 `scripts/hooks/*.js` 的共享实现，无需为 Cursor 重写 hook 逻辑
- 通过 `run-with-flags.js` 实现 hook runtime profile（minimal/standard/strict）和禁用列表

### 5.2 插件元数据分层

| 文件 | 用途 |
|------|------|
| `.claude-plugin/plugin.json` | 声明 skills/commands 路径，**不显式声明 hooks**（v2.1+ 自动加载） |
| `.claude-plugin/marketplace.json` | 自托管市场配置 |
| `.codex-plugin/plugin.json` | Codex 插件元数据 |
| `.cursor/hooks.json` | Cursor hook 配置（预翻译的事件映射） |
| `.opencode/instructions/INSTRUCTIONS.md` | OpenCode 统一指令入口 |

**关键教训**：ECC 曾因在 `plugin.json` 中显式声明 `"hooks"` 字段导致与 Claude Code v2.1+ 的自动加载机制冲突，引发多次 fix/revert 循环，最终用回归测试锁定"不在 plugin.json 中声明 hooks"。

---

## 六、Skill 定义、发现、加载机制

### 6.1 SKILL.md 标准格式

```markdown
---
name: skill-name
description: 一行描述，用于技能列表和自动激活
origin: ECC
---

# Skill Title

## When to Activate
## Core Concepts
## Code Examples
## Anti-Patterns
## Best Practices
## Related Skills
```

### 6.2 发现与加载

- Claude Code：`plugin.json` 的 `"skills": ["./skills/"]` 声明，自动扫描子目录中的 `SKILL.md`
- Codex：`.agents/skills/` 下的 `SKILL.md` 被自动加载
- 本地开发：直接复制到 `~/.claude/skills/<name>/SKILL.md`

### 6.3 Skill 审计与治理（skill-stocktake）

- **Quick Scan**：基于 `results.json` 的 mtime 差异扫描，仅审计变更 skill
- **Full Stocktake**：完整评估所有 skill，输出 `Keep / Improve / Update / Retire / Merge` 判决
- **评估维度**：Actionability、Scope fit、Uniqueness、Currency
- **证据要求**：`reason` 字段必须自包含，禁止写 "unchanged" 等空泛结论

---

## 七、配置系统与扩展点

### 7.1 选择性安装架构（Selective Install）

**Manifest 层**：
- `manifests/install-modules.json`：模块目录（id、kind、paths、targets、dependencies、cost、stability）
- `manifests/install-profiles.json`：安装配置（core / developer / security / research / full）

**安装流程分层**（已部分实现）：
1. CLI Surface → 2. Request Normalizer → 3. Module Resolver → 4. Target Planner → 5. Operation Planner → 6. Execution Engine → 7. Install-State Persistence → 8. Lifecycle Services

**安装状态契约**（`install-state.json`）：
```json
{
  "schemaVersion": "ecc.install.v1",
  "target": { "id": "claude-home", "root": "~/.claude" },
  "request": { "profile": "developer", "modules": [...] },
  "resolution": { "selectedModules": [...], "skippedModules": [...] },
  "operations": [
    { "kind": "copy", "moduleId": "rules-core", "destination": "...", "digest": "sha256:..." }
  ]
}
```

**生命周期命令**：
- `ecc list-installed`：查看已安装状态
- `ecc doctor`：检测缺失或漂移文件
- `ecc repair`：基于 install-state 修复
- `ecc uninstall`：仅移除 ECC 管理的文件
- `ecc consult "security reviews"`：自然语言查询推荐组件

### 7.2 Hook 运行时控制

```bash
export ECC_HOOK_PROFILE=minimal|standard|strict
export ECC_DISABLED_HOOKS="pre:bash:tmux-reminder,post:edit:typecheck"
export ECC_SESSION_START_MAX_CHARS=4000
export ECC_SESSION_START_CONTEXT=off
```

Hook 通过 `run-with-flags.js` 统一调度，支持按 profile 启用/禁用。

### 7.3 规则分层架构

```
rules/
├── common/           # 语言无关
├── typescript/       # TS/JS 特定
├── python/           # Python 特定
├── golang/           # Go 特定
└── ...
```

安装时按需复制，避免一次性加载全部规则消耗上下文。

---

## 八、对 gxpm 的借鉴价值

### 8.1 可直接复用的模式 ✅

| 模式 | ECC 实践 | gxpm 应用点 |
|------|----------|-------------|
| **Skill 格式标准化** | YAML frontmatter + Markdown 正文 | 统一 `origin` 字段和反模式章节 |
| **Agent 定义格式** | Markdown + YAML frontmatter（name, description, tools, model） | 可在 `hosts/` 或新增 `agents/` 引入 |
| **分层规则** | `common/` + 语言特定目录，按需安装 | `docs/governance/` 可按 host 或语言分层 |
| **安装状态持久化** | `install-state.json` 记录完整操作链条 | `.gxpm/` 本地 state 可借鉴 operation 概念 |
| **生命周期 CLI** | `ecc doctor/repair/uninstall/list-installed` | `gxpm cleanup land` 可扩展为 `gxpm doctor/repair` |
| **Hook Profile** | minimal/standard/strict + 禁用列表 | `.gxpm/config.json` 可增加 hook profile 控制 |
| **跨 Harness Adapter** | Cursor `adapter.js` 转换事件格式 | `hosts/claude.ts` vs `hosts/codex.ts` 可引入 adapter 层 |
| **Skill 审计** | `skill-stocktake` 的 verdict/reason 机制 | skill 治理可引入定期审计和淘汰机制 |
| **Token 优化指南** | `MAX_THINKING_TOKENS` / `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` | `AGENTS.md` 可增加 host 特定的 token 管理建议 |
| **CI 验证严格性** | 校验 agents/commands/rules/skills/hooks/install-manifests 的一致性 | `bun run check` 可扩展类似校验 |

### 8.2 应避免的陷阱 ❌

| 陷阱 | ECC 历史问题 | gxpm 预防措施 |
|------|--------------|---------------|
| **安装方法叠加导致重复** | `/plugin install` + `./install.sh` 导致重复加载 | 确保单一安装/发现路径，避免 `skills/` 与 `.gxpm/skills/` 重复 |
| **Hook 加载与 harness 版本紧耦合** | Claude Code v2.1+ 自动加载导致 duplicate detection error | host adapter 应抽象 hook 注册机制 |
| **安装状态不可追溯（1.x）** | 早期无 install-state，uninstall/doctor 只能猜测 | `.gxpm/issues/` 和 `.gxpm/local/` 应纳入统一 state |
| **跨 harness 同步成本过高** | `.cursor/`、`.codex/`、`.opencode/` 需分别维护 | 未来扩展时采用 adapter 模式，避免完整副本 |
| **Commands 与 Skills 双轨并行** | 维护成本高，commands 逐步 deprecate | 坚持 skills-first，CLI 命令直接调用 skill 逻辑 |

---

## 九、关键文件映射

| ECC 文件/模式 | gxpm 对应位置/建议 |
|---------------|---------------------|
| `scripts/lib/install-state.js` | `.gxpm/` state 可引入 `operations` 数组概念 |
| `manifests/install-modules.json` | capability registry 的分级机制（cost, stability, defaultInstall） |
| `docs/architecture/cross-harness.md` | 写入 `docs/architecture/host-adapter.md` |
| `ecc2/` Rust 控制平面 | gxpm 未来原生运行时的技术选型参考 |
| `.cursor/hooks/adapter.js` | `hosts/` 引入 adapter 层减少 host 特定逻辑重复 |
| `tests/validate-*.js` | `bun run check` 扩展 catalog 一致性校验 |

---

## 十、适配建议

1. **Install-State 模型**：完整阅读 `scripts/lib/install-state.js`，将 `operations` 数组概念引入 gxpm 的 `.gxpm/` state，使 land/cleanup 能精确追溯文件/分支/worktree 的创建记录。
2. **Capability Registry 分级**：参考 `manifests/install-modules.json` 的 `cost`、`stability`、`defaultInstall`、`targets` 字段设计 gxpm capability registry。
3. **Host Adapter 契约**：将 ECC 的 "共享源 + 适配层" 原则写入 `docs/architecture/host-adapter.md`，作为未来扩展 Cursor/OpenCode 的架构基准。
4. **Hook Profile 控制**：在 `.gxpm/config.json` 中增加 hook profile 和禁用列表配置，避免 hook 过度侵入。
5. **Catalog 一致性校验**：参考 ECC 的 `validate-agents.js`、`validate-skills.js` 等，在 `bun run check` 中增加 skill/agent 与 manifest 的脱钩检测。

---

## 十一、一句话总结

> ECC 是**经过大规模生产验证的成熟插件生态系统**，其在 **Manifest 驱动的选择性安装、跨 Harness 适配层、Hook 运行时治理、Install-State 持久化** 上的工程实践，可直接补足 gxpm 的扩展生态与运维治理层面；gxpm 应坚持独立产品定位，吸收其分发和治理模式，而非复制其插件包架构。
