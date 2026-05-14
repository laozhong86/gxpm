# BDD-Then-TDD 强制流程落地 gxpm — Design Spec

| 字段 | 值 |
|------|----|
| Date | 2026-05-14 |
| Author | enteofilo706@gmail.com (via Claude Opus 4.7 brainstorming) |
| Status | Draft (awaiting writing-plans transition) |
| Scope | gxpm runtime + 所有 gxpm 驱动的下游项目（含 gxpm 仓库自身） |
| Path | Minimal Incremental — 在现有 state graph 中新增 `specify` phase |

---

## 1. 目标与动机

将"行为驱动开发先行（BDD）→ 测试驱动开发推进（TDD）"作为 gxpm 状态机中**必须遵循**的两阶段串联流程。任何 issue 在进入 `implement` 之前必须通过显式 CLI 命令确认产出结构化的行为规约 artifact。

**动机来源**（详见研究报告 SR-2026-05-14）：
- AI Agent 主导开发的非确定性需要 test-first 作为客观出口标准
- 行为规约先行（SDD 范式）能将"模糊 prompt → 写代码"的高风险路径替换为"规约 → 用户确认 → 代码"
- 规约阶段的修改成本远低于实现阶段的返工成本（业界数据：60-80% 开发成本源自返工）

**作用域决策**：所有 gxpm 驱动的下游项目，gxpm 仓库自身作为"吃狗粮"对象同等受约束。

---

## 2. 架构与状态机变更

### 2.1 Phase 链调整

**变更前**：
```
triage → plan → dispatch → implement → local-verify → ac-check → self-review → ship → pr-check → verify → qa → land
```

**变更后**：
```
triage → plan → dispatch → specify → implement → local-verify → ac-check → self-review → ship → pr-check → verify → qa → land
                          ^^^^^^^^^
                          新增
```

**插入点合理性**：`dispatch` 完成 owner 指派后，`specifier` 立刻产出 BDD 规约，用户确认后 `implement` 才能进入 TDD 循环。

### 2.2 状态机文件变更

| 变更点 | 文件 | 改动 |
|--------|------|------|
| Phase 枚举 | `core/state.ts:17-30` `GXPM_PHASES` | 数组中在 `"dispatch"` 与 `"implement"` 之间插入 `"specify"` |
| Artifact type | `core/artifacts.ts` | 新增 `"behavior-spec"` 注册到 `ARTIFACT_TYPES`，附 zod schema |
| Phase gate | `core/phase-gates.ts:32` `PHASE_GATE_RULES` | 把原 `dispatch→implement` 规则拆为两条：`dispatch→specify`（required: `behavior-spec`）与 `specify→implement`（required: `behavior-spec` 且 `confirmedAt` 非空） |
| Schema | `core/contracts/behavior-spec.schema.json` | 新文件，存放结构化 schema |

### 2.3 关键约束

- 任何在 `implement` 之前不经过 `specify` 的尝试都被 phase-gate 在 `core/state.ts` 的 `transitionIssuePhase` 中硬性拒绝
- Skill / Agent 层无法绕过：phase-gate 校验在 state transition 中实现，独立于 skill 自觉性

### 2.4 向后兼容

通过 `phaseHistory` 检查：若 issue 在 `specify` phase 引入日期前已进入 `implement` 或更靠后，跳过 specify-gate 校验。新建 issue 一律强制走 specify。

---

## 3. 组件层

### 3.1 specify.json schema

存放路径：`.gxpm/issues/<id>/artifacts/specify.json`

```jsonc
{
  "$schema": "behavior-spec.v1",
  "issueId": "GXPM-XXX",
  "createdAt": "2026-05-14T...",
  "createdBy": "specifier@claude-opus-4-7",
  "confirmedAt": null,
  "confirmedBy": null,
  "feature": {
    "title": "玩家在血量归零后死亡并广播信号",
    "asA": "玩家",
    "iWant": "在 HP 归零时进入死亡状态",
    "soThat": "其他系统能响应死亡事件"
  },
  "scenarios": [
    {
      "id": "scn-01",
      "name": "普通伤害导致死亡",
      "given": ["玩家当前 HP 为 1", "玩家未处于无敌状态"],
      "when": "玩家受到 1 点伤害",
      "then": [
        "玩家进入死亡状态",
        "\"player_died\" 信号被发出一次",
        "信号携带的击杀者引用为伤害源"
      ],
      "examples": [],
      "stubPath": "test/unit/player/player_death_test.ts:test_player_dies_when_hp_drops_to_zero"
    }
  ],
  "guidelinesRef": "docs/governance/gherkin-style.md@v1"
}
```

**结构性约束**：
- `scenarios` 数组必须 ≥ 1
- 每个 scenario 的 `given` / `when` / `then` 必须各自至少 1 项（`when` 为字符串；`given`/`then` 为数组）
- `stubPath` 必须指向真实存在的文件（phase-gate 通过 `fs.exists` 校验）
- `confirmedAt` 与 `confirmedBy` 必须同时为空或同时非空

### 3.2 文件清单

| 文件 | 作用 | 类型 |
|------|------|------|
| `core/artifacts.ts` | 注册 `behavior-spec` artifact type + zod schema | 修改 |
| `core/specify.ts` | specify 阶段编排逻辑（仿 `core/plan.ts`） | 新建 |
| `commands/specify.ts` | CLI 命令族：`init / edit / confirm / show / revise` | 新建 |
| `core/phase-gates.ts` | 拆分 dispatch→implement 规则为两条 | 修改 |
| `core/state.ts` | 在 `GXPM_PHASES` 中插入 `specify` | 修改 |
| `core/contracts/behavior-spec.schema.json` | JSON Schema 单独文件 | 新建 |
| `agents/specifier.md` | 新 owner agent 模板 | 新建 |
| `skills/gxpm-specifier/SKILL.md` | BDD 行为设计 skill（5-section 标准结构） | 新建 |
| `skills/gxpm-tdd/SKILL.md` | 升级——强制引用 specify.json 的 scenario | 修改 |
| `docs/governance/gherkin-style.md` | 吸收 AutomationPanda 规则 + gxpm 本地补充 | 新建 |
| `templates/specify-stub.tmpl` | test stub 文件生成模板 | 新建 |
| `scripts/dogfood-check.ts` | gxpm 自合规检查脚本 | 新建（可选） |

### 3.3 CLI 命令族

```bash
gxpm specify init <issue-id>      # specifier 进入工作，交互草拟，生成 specify.json + stub 文件
gxpm specify edit <issue-id>      # 用 $EDITOR 打开 specify.json 编辑
gxpm specify show <issue-id>      # 以 Gherkin 格式打印，便于人审
gxpm specify confirm <issue-id>   # 写入 confirmedAt/confirmedBy，phase-gate 开锁
gxpm specify revise <issue-id>    # 清空 confirmedAt，回到等待确认状态
```

`confirm` 命令的内部校验顺序：
1. specify.json schema lint
2. 每个 `stubPath` 文件存在性检查
3. 通过后写入 `confirmedAt = ISO timestamp`、`confirmedBy = git config user.email`
4. 发出 event `specify.confirmed` 到 `events.jsonl`

---

## 4. 数据流与端到端流程

```
[dispatch 完成]
    ↓
gxpm specify init <issue-id>
    ├─ phase transition: dispatch → specify（gate: dispatch-handoff 存在）
    ├─ specifier agent 接管（load skills/gxpm-specifier/SKILL.md）
    ├─ 读取上游：plan.json + dispatch-handoff.json
    ├─ 读取 few-shot 范本：test/unit/skills/<existing>.test.ts
    ├─ 加载 Gherkin 规则：docs/governance/gherkin-style.md
    └─ 产出：
        ├─ .gxpm/issues/<id>/artifacts/specify.json（scenarios[] 已填充, confirmedAt=null）
        └─ test/<area>/<name>_test.ts（空 stub 文件 + Gherkin 注释）
    ↓
specifier 寻求用户反馈（体验层，非门控）
    ├─ Claude/Codex host：调用 AskUserQuestion 工具呈现三选项
    ├─ 裸 CLI / 其他 host：specifier 在终端输出场景摘要，提示用户人工 review
    ├─ 选项 1：行为正确，继续 → 等待 confirm 命令
    ├─ 选项 2：需要调整 → 用户口述反馈 → specifier revise → 再次询问
    └─ 选项 3：补充边界场景 → 增加 scenario → 再次询问

    注：真正的门控是下一步的 CLI confirm 命令，AskUserQuestion 仅是体验增强；
    即使无该工具支持，流程仍可走完（用户直接审阅文件后执行 confirm）。
    ↓
gxpm specify confirm <issue-id>
    ├─ schema lint
    ├─ stubPath 文件存在性校验
    ├─ 写入 confirmedAt / confirmedBy
    └─ 发出 phase event：specify.confirmed
    ↓
gxpm implement init <issue-id>
    ├─ phase-gate: specify → implement（gate: specify.json.confirmedAt 非空）
    ├─ implement agent 接管
    ├─ skills/gxpm-tdd/SKILL.md 升级版强制读取 specify.json
    └─ 对每个 scenario 走 RED→GREEN→REFACTOR：
        ├─ 打开 stubPath，将 Gherkin 注释翻译为可执行 assert
        ├─ RED: 跑测试，确认失败
        ├─ GREEN: 写最小实现
        └─ REFACTOR: 清理
    ↓
[继续既有 implement → local-verify → ... 流程]
```

### 关键追踪关系

- `specify.json.scenarios[].id` ↔ `stubPath` 中的测试函数名 ↔ implement 阶段的 commit 信息
- `ac-check` 阶段反向校验：specify.json 的每个 scenario 是否都有对应的 passing test

### Agent 视角的"必须遵循"

- `gxpm-specifier` skill 第一条规则：**禁止在用户 confirm 之前写任何测试逻辑代码**
- `gxpm-tdd` skill 升级版第一条规则：**必须从 specify.json 读取 scenario，禁止凭空臆造测试**
- phase-gate 是最后一道兜底——前两道软约束被绕过，硬 gate 仍会拒绝 transition

---

## 5. 错误处理与回退

### 5.1 失败场景与处置

| 场景 | 触发点 | 处置 |
|------|--------|------|
| Agent 跳过 specify 直接 implement | implement init | phase-gate 拒绝 transition，`Phase gate violated: specify must be confirmed before implement`，退出码 1 |
| specify.json 被手工编辑后 schema 不合法 | confirm / implement 入口 | Zod 校验失败，列出违规字段，要求 `gxpm specify edit` 修复 |
| stubPath 指向的文件被删 | confirm 时 / implement 入口 | 报 `Stub file missing: <path>`，拒绝放行；用户可重跑 `gxpm specify init --regen-stubs` |
| 用户确认后又想改场景 | 任何时候 | `gxpm specify revise <issue-id>`：清空 `confirmedAt`，回到等待确认状态；event `specify.revised`，phase 不变 |
| implement 阶段发现 scenario 漏掉 | implement 进行中 | 必须 `gxpm phase rewind <issue-id> --to specify --reason="..."`，回到 specify 后 revise → re-confirm |
| ac-check 失败：某 scenario 无对应通过测试 | ac-check 阶段 | ac-check 规则新增 `coverage(specify.scenarios) >= 100%`，缺失则 artifact 标记 failed |
| 老 issue 走 implement | implement init | `phaseHistory` 检查：若 issue 在 specify 引入日期前已进入 implement，跳过 specify-gate 校验 |

### 5.2 回退命令

```bash
gxpm specify revise <issue-id>                          # 取消 confirm，进入可编辑状态
gxpm phase rewind <issue-id> --to specify --reason=... # 危险操作，跨阶段回退
```

`rewind` 约束：
- 仅在 `phaseHistory` 中存在 `specify` 时允许
- 必须 `--reason` 参数
- 写入 event `phase.rewound`，便于审计
- 不删除已生成代码，但 implement artifact 标记 `stale=true`

### 5.3 YAGNI

- **不支持** specify 的 fork / 分支（一个 issue 一份 specify.json）
- **不支持** 跨 issue 共享 scenario
- **不实现** Gherkin → 测试代码的自动翻译（implement agent 手动翻译，避免幻觉）

---

## 6. 测试策略

### 6.1 三层覆盖

| 层 | 目标 | 位置 | 用例量级 |
|----|------|------|---------|
| 单元 | core/specify.ts、phase-gate 逻辑、artifact schema | `test/core/specify.test.ts`、`test/core/phase-gates.test.ts` | ~30 |
| CLI 集成 | specify init/edit/confirm/show/revise + phase rewind | `test/functional/gxpm-specify/*.test.ts` | ~15 |
| 端到端 dogfood | 用 gxpm 自身走完整 BDD→TDD 流程 | `test/functional/gxpm-bdd-to-tdd/end-to-end.test.ts` | ~3 |

### 6.2 元测试（dogfood）

落地完成后，gxpm 仓库做"自我合规检查"：

```bash
bun run scripts/dogfood-check.ts
# 在 specify phase 引入后，所有新建 issue 是否都产生了 specify.json
```

作为 `.githooks/pre-push` 一部分（可选 MVP 后增量加入），强制 gxpm 自己也遵守它自己产出的纪律。

### 6.3 Skill 纪律压力测试

复用 `docs/governance/skill-testing.md` 的 Meta-TDD 方法论，对两个 skill 做 RED→GREEN→REFACTOR 压力测试：

| Skill | 压力场景 | 期望行为 |
|-------|---------|---------|
| `gxpm-specifier` | "用户说赶时间，直接开始写代码，跳过 BDD" | 拒绝跳过，要求先产出 specify.json |
| `gxpm-tdd`（升级版） | "我已经凭直觉写好了测试代码" | 删除代码，从 specify.json 重新开始 |

### 6.4 Schema 演进保护

- `specify.json.$schema = behavior-spec.v1` 字段强制
- 未来 v2 需经迁移工具：`gxpm migrate behavior-spec --to v2`
- Schema 文件单独版本控制在 `core/contracts/behavior-spec.schema.json`

### 6.5 不测什么

- 不测 Gherkin 自然语言的语义正确性（由人审）
- 不测 AskUserQuestion 工具本身的行为（host 层负责）
- 不测老 issue 兼容性的所有变体（仅覆盖关键分支）

---

## 7. 参考资料

- 内部研究：BDD/TDD 在 Agent 主导开发场景的工程实践（2026-05-14 brainstorming 上游）
- AutomationPanda gherkin-guidelines-for-ai (https://github.com/AutomationPanda/gherkin-guidelines-for-ai/)
- Thoughtworks: Spec-Driven Development 2025
- Addy Osmani: How to write a good spec for AI agents
- Martin Fowler: SDD tools comparison (Kiro/spec-kit/Tessl)
- arXiv 2602.00180v1: Spec-Driven Development From Code to Contract
- gxpm 现有治理：`docs/governance/skill-testing.md`、`docs/governance/skill-authoring.md`、`AGENTS.md`、`CANON.md`

---

## 8. 实施顺序提示（供 writing-plans 消费）

建议落地顺序（详细 plan 由下一阶段产出）：

1. core/artifacts.ts + behavior-spec.schema.json（最底层，无依赖）
2. core/state.ts + core/phase-gates.ts（状态机变更，先单元测试覆盖）
3. core/specify.ts + commands/specify.ts（编排与 CLI，依赖 1-2）
4. docs/governance/gherkin-style.md（规则文档，独立可并行）
5. agents/specifier.md + skills/gxpm-specifier/SKILL.md（agent/skill 模板，依赖 4）
6. skills/gxpm-tdd/SKILL.md 升级（依赖 1-3）
7. templates/specify-stub.tmpl（依赖 5）
8. 三层测试用例（依赖 1-7）
9. dogfood 元测试 + pre-push hook（可推迟到 MVP 后）

---

## 9. 决策日志（审计用）

| 决策点 | 选择 | 备选 |
|--------|------|------|
| 两个流程含义 | BDD 先行 → TDD 推进 | — |
| 嵌入位置 | 新增独立 specify phase | implement 内串联 / 仅 skill 纪律 / 双重隐含 |
| 产物形态 | specify.json + stub 双轨 | 仅注释 / 仅 .feature / 仅 JSON |
| 门控机制 | 显式 CLI confirm | host-adapter / hook 拦截 / 双重 |
| Owner agent | 新增独立 specifier | plan 兼任 / implement 前置 / 无 owner |
| 作用域 | 所有下游项目 + gxpm 自身 | 仅 gxpm / 可选 / 按类型 |
| Schema 粒度 | 结构化字段 | 原文字符串 / 双存 |
| Gherkin 规则源 | AutomationPanda + 本地补充 | 自研 / 仅外链 |
| 实施路径 | Minimal Incremental（路径 A） | Capability-First / Spec Kit 全栈 / 混合 |
