---
name: using-gxpm-runtime
description: gxpm 运行时启动合约——任何 artifact 或代码改动之前，agent 必须先 `gxpm issue next <id> --json` 拿到 requiredSkill 并 invoke。本合约由 SessionStart hook 自动注入，无需手动加载。
type: bootstrap
---

# using-gxpm-runtime

> 你正在一个由 **gxpm** 管理的工作区。本节是每次 SessionStart 注入的合约，**不可忽略**。

## Phase-anchored 硬约束

1. 每次开始任何 gxpm issue 相关工作前，先运行 `gxpm issue next <id> --json`（`<id>` 必传；如果不确定当前 issue id，先 `gxpm issue list` 或读取 worktree 内 `.gxpm-worktree-owner.json` 的 `ownerIssueId`）。
2. 该命令返回的 `requiredSkill` 字段告诉你当前 phase 必须先调用哪个 skill。**MUST invoke requiredSkill** 后再写任何 artifact / 代码 / 测试。
3. 若 `requiredSkill === null`（如 `dispatch` / `ship` 阶段），可继续；其余情况强制执行。
4. Phase 转换通过 `gxpm issue transition <id> <next>` 或 `gxpm issue handoff <id> --to-next-phase`，禁止跳过 artifact 直接写文件。

## 三条不可妥协的原则

- **真值优先**：先读 `CANON.md`、当前 issue 的 artifacts、相关 skill 源码，再动手。
- **Artifact 先决**：每个 phase 推进前先写完 artifact（acceptance-contract / implementation-plan / behavior-spec / local-verify / …），用 `gxpm artifact write`，**禁止手改** `.gxpm/issues/<id>/*.json`。
- **Worktree 隔离**：implement 阶段进入独立 worktree；`git status -sb` 出现 3+ 未追踪文件先用 `gxpm workspace ensure <id>` 隔离。

## 快速参考

| 当前不知道下一步 | `gxpm issue next <id> --json` |
| 想看 issue 全貌 | `gxpm issue status <id>` |
| 拿不准要调哪个 skill | 查上行命令返回的 `requiredSkill` 字段 |
| 工作完成想推进 phase | 先 `gxpm artifact write`，再 `gxpm issue transition` |
| 想停下让其他 agent 接力 | invoke `gxpm-handoff` 写 phase-handoff artifact |

违反本合约的产物视为不符合规范，下游 phase gate 会拒绝。

## When to trigger

本合约由 `core/hook-engine.ts` 的 SessionStart 分支在每个 initialized gxpm 项目内自动注入，**不应被 agent 手动调用**。出现以下场景时，说明合约生效中：

- 进入一个 `.gxpm/` 初始化过的工作目录新会话。
- 在 gxpm worktree 中执行 `gxpm issue transition` / `gxpm issue handoff --to-next-phase` 后的下一轮。
- 任何 `gxpm issue next <id> --json` 返回了非空 `requiredSkill` 字段时。

## 可操作流程

每次合约生效后，agent 应按以下顺序展开工作：

1. 跑 `gxpm issue next <id> --json`，记录返回的 `currentPhase` / `requiredSkill` / `requiredArtifact`。
2. 若 `requiredSkill` 非空，先 `Skill(<requiredSkill>)` invoke 它，**再写任何 artifact / 代码 / 测试**。
3. 按 invoked skill 的内部流程产出对应 artifact，用 `gxpm artifact write` 落盘。
4. Phase 推进只走 `gxpm issue transition <id> <next>` 或 `gxpm issue handoff <id> --to-next-phase`。

## 红旗 / 反模式

下列行为视为违约，应立即停下来回到流程：

- 没读 `gxpm issue next <id> --json`，凭记忆推断当前 phase。
- 当前 phase 有 `requiredSkill` 但未 invoke 就开始 Edit / Write 任何源码或 artifact。
- 直接手改 `.gxpm/issues/<id>/*.json`（应通过 `gxpm artifact write` / `gxpm artifact edit`）。
- 跨 phase 写跨阶段 artifact（如在 plan 阶段写 behavior-spec）。

## 验证清单 / 出口条件

每轮工作收尾前自查：

- [ ] 本轮所有 artifact 改动都对应当前 phase 的 `requiredArtifact`。
- [ ] 进入新 phase 前已 invoke 该 phase 的 `requiredSkill`（或确认其为 null）。
- [ ] 没有手改 `.gxpm/issues/<id>/*.json` 留下脏数据。
- [ ] 任何 phase 推进都通过 `gxpm issue transition` / `gxpm issue handoff` 命令。

## References

- `core/hook-engine.ts` — SessionStart 注入入口与 `loadGxpmRuntimeBootstrap()` 实现。
- `core/phase-gates.ts` — `PHASE_GATE_RULES` 注册了每个 phase 的 `requiredSkill`。
- `CANON.md` — 上层行为宪法，本合约是其在 runtime 层的具体投影。
- `skills/gxpm/SKILL.md` — gxpm 主 skill，介绍 CLI 与工作流全貌。
