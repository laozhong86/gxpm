# gxpm 架构图

> 基于 `gxpm-replacement-architecture.md` 和 `gxpm-v0-contract.md` 绘制

---

## 1. 顶层公式

```text
gxpm = State Graph + Capability Runtime + Evidence Store + Policy Engine + Skill Surface
```

---

## 2. 整体架构图 (Mermaid)

```mermaid
flowchart TB
    subgraph User["👤 用户 / Agent"]
        CLI["gxpm CLI\n/gxpm triage | plan | dispatch | verify | qa | land | ship ..."]
    end

    subgraph SkillSurface["🎤 Skill Surface"]
        CMD_Triage["gxpm triage"]
        CMD_Plan["gxpm plan"]
        CMD_Dispatch["gxpm dispatch"]
        CMD_Implement["gxpm implement"]
        CMD_Verify["gxpm verify"]
        CMD_QA["gxpm qa"]
        CMD_Land["gxpm land"]
        CMD_Ship["gxpm ship"]
        CMD_Review["gxpm review"]
        CMD_Investigate["gxpm investigate"]
        CMD_Learn["gxpm learn"]
    end

    subgraph Core["🔧 gxpm Core (统一控制面)"]
        direction TB

        subgraph StateGraph["📊 State Graph"]
            Issue["Issue 状态机"]
            Phase["Phase 阶段\ntriage → plan → dispatch → implement → local-verify → ac-check → self-review → ship → pr-check → verify → qa → land"]
            Transition["Transition Gate\n(严格顺序 + artifact 校验)"]
            Graph["Graph.json\n(依赖图 / 阻塞关系)"]
        end

        subgraph PolicyEngine["⚖️ Policy Engine"]
            Gate["Gate 判定\n(能进入下一阶段吗?)"]
            AC["Acceptance Criterion\n(哪些需要 browser evidence?)"]
            Risk["Risk Profile\n(fast / standard / high-risk / regression)"]
            Confirm["不可逆操作确认\n(land/merge/deploy)"]
        end

        subgraph CapabilityRuntime["🚀 Capability Runtime"]
            IssueRT["issueRuntime\n(Linear/GitHub sync)"]
            ExecRT["executionRuntime\n(worktree / dispatch / verify)"]
            ReviewRT["reviewRuntime\n(diff / specialist / adversarial)"]
            BrowserRT["browserRuntime\n(QA / screenshot / console)"]
            ReleaseRT["releaseRuntime\n(PR / version / changelog)"]
            MemoryRT["memoryRuntime\n(timeline / learn / resume)"]
            SkillRT["skillRuntime\n(discovery / routing / template)"]
        end

        subgraph EvidenceStore["📁 Evidence Store"]
            State["state.json"]
            Artifacts["artifacts/*.json\n(acceptance-contract, dispatch-handoff,\nlocal-verify, qa-findings, land-findings...)"]
            Evidence["evidence/\n(screenshots, console.jsonl,\nnetwork.jsonl, commands.jsonl)"]
            Memory["memory/\n(resume-packet.json, checkpoints/)"]
            Runs["runs/\n(run-ledger, 审计日志)"]
        end
    end

    subgraph External["🌐 外部系统"]
        Linear["Linear (Issue Provider)"]
        GitHub["GitHub (PR / Code)"]
        Browser["Browser / QA 环境"]
    end

    subgraph Hosts["💻 Host Adapters"]
        Codex["Codex CLI"]
        Claude["Claude Code"]
        OpenClaw["OpenClaw / 其他"]
    end

    subgraph Codebase["📂 代码库"]
        Worktree["git worktree\n(隔离开发)"]
        Source["源代码"]
    end

    %% === 连接关系 ===
    User --> CLI
    CLI --> SkillSurface

    SkillSurface --> StateGraph
    SkillSurface --> CapabilityRuntime

    StateGraph <-- "读写 state / graph" --> EvidenceStore
    CapabilityRuntime <-- "写入 evidence / artifacts" --> EvidenceStore
    CapabilityRuntime --> PolicyEngine
    PolicyEngine --> StateGraph

    IssueRT --> Linear
    ReleaseRT --> GitHub
    BrowserRT --> Browser
    ExecRT --> Worktree

    Hosts --> CLI
    Codebase --> ExecRT
```

---

## 3. 核心数据流

```mermaid
sequenceDiagram
    autonumber
    actor U as 用户 / Agent
    participant SS as Skill Surface
    participant SG as State Graph
    participant PE as Policy Engine
    participant CR as Capability Runtime
    participant ES as Evidence Store
    participant EX as 外部系统 (Linear/GitHub)

    U->>SS: gxpm triage init GXPM-001
    SS->>SG: 读取当前 phase (triage)
    SG->>PE: 请求 gate 判定
    PE-->>SG: 允许 (当前 phase = triage)
    SS->>CR: 调用 issueRuntime + planning
    CR->>EX: 从 Linear 读取 issue 详情
    CR->>ES: 写入 artifact: acceptance-contract.json
    CR-->>SS: 返回 triage 结果
    SS->>SG: 推进 phase: triage → plan
    SG->>ES: 更新 state.json + events.jsonl
    SS-->>U: 完成 triage

    U->>SS: gxpm plan init GXPM-001
    SS->>SG: 读取 phase (plan)
    SG->>PE: gate 判定 (需 acceptance-contract)
    PE->>ES: 检查 artifacts/acceptance-contract.json
    ES-->>PE: 存在 ✓
    PE-->>SG: 允许
    SS->>CR: 调用 planning capability
    CR->>ES: 写入 artifact: implementation-plan.json
    SS->>SG: 推进 phase: plan → dispatch
    SG->>ES: 更新 state
    SS-->>U: 完成 plan

    Note over U,EX: ... 各阶段以此类推 ...

    U->>SS: gxpm qa land GXPM-001
    SS->>SG: 读取 phase (qa)
    SG->>PE: gate 判定 (需 qa-findings, land-findings)
    PE->>ES: 检查所有前置 artifacts
    ES-->>PE: 全部存在 ✓
    PE->>PE: 判定是否涉及不可逆操作
    PE-->>U: 请求用户确认
    U-->>PE: 确认
    PE-->>SG: 允许
    SS->>CR: 调用 releaseRuntime
    CR->>EX: GitHub merge PR
    SS->>SG: 推进 phase: qa → land
    SG->>ES: 最终 state 更新
    SS-->>U: land 完成
```

---

## 4. V0 本地目录结构 (Evidence Store 实体)

```text
.gxpm/
└── issues/<issue-id>/
    ├── state.json              ← 状态机真值
    ├── graph.json              ← 依赖/阻塞关系
    ├── events.jsonl            ← 阶段转换审计日志
    ├── artifacts/
    │   ├── index.json
    │   ├── acceptance-contract.json
    │   ├── implementation-plan.json
    │   ├── dispatch-handoff.json
    │   ├── local-verify.json
    │   ├── acceptance-check.json
    │   ├── self-review.json
    │   ├── ship-readiness.json
    │   ├── pr-check.json
    │   ├── verify-findings.json
    │   ├── qa-findings.json
    │   └── land-findings.json
    ├── reports/                ← (未来) Markdown 渲染视图
    ├── evidence/
    │   ├── command-logs/
    │   ├── browser-snapshots/
    │   ├── browser-screenshots/
    │   ├── browser-console/
    │   ├── browser-errors/
    │   ├── investigations/
    │   ├── review/
    │   ├── release/
    │   └── screenshots/        ← 兼容旧路径
    ├── memory/
    │   ├── resume-packet.json  ← 会话恢复入口
    │   └── checkpoints/
    │       └── 20260427-044500-handoff.md
    └── runs/
        └── run-20260428123000-1a2b3c4d.json
```

---

## 5. 真值优先级金字塔

```text
        ┌─────────────────┐
        │  phase JSON     │  ← 最高真值
        │  artifacts      │
        ├─────────────────┤
        │   state.json    │
        ├─────────────────┤
        │ resume-packet   │
        ├─────────────────┤
        │ rendered md     │
        │ reports         │
        ├─────────────────┤
        │ Linear comments │
        │ PR body         │
        │ chat history    │  ← 最低真值
        └─────────────────┘
```

---

## 6. 与上游项目的关系

```text
┌─────────────────────────────────────────────────────────────┐
│                        gxpm (二代产品)                       │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────┐ │
│  │  State Graph │  │ Capability   │  │   Evidence Store    │ │
│  │  (统一状态机)│  │ Runtime      │  │   (统一证据层)       │ │
│  └─────────────┘  │ (统一能力)   │  └─────────────────────┘ │
│                   └──────────────┘                          │
│                           ▲                                 │
│         ┌─────────────────┴─────────────────┐               │
│         ▼                                   ▼               │
│   ┌─────────────┐                   ┌─────────────┐         │
│   │    PMC      │  ── 吸收/迁移 ──▶ │  gxpm Core  │         │
│   │(phase gate, │                   │ (native)    │         │
│   │ checkpoint) │                   │             │         │
│   └─────────────┘                   └─────────────┘         │
│   ┌─────────────┐                   ┌─────────────┐         │
│   │   gstack    │  ── 吸收/迁移 ──▶ │  gxpm Core  │         │
│   │(browser QA, │                   │ (native)    │         │
│   │ review,ship)│                   │             │         │
│   └─────────────┘                   └─────────────┘         │
│                                                             │
│   原则：PMC/gstack 是上游研究对象与能力来源，不是长期运行时依赖   │
└─────────────────────────────────────────────────────────────┘
```

---

*生成时间: 2026-05-02*
*来源文档: `docs/architecture/gxpm-replacement-architecture.md`, `docs/architecture/gxpm-v0-contract.md`*
