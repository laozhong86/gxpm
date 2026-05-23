---
name: gxpm-verify
type: technique
description: MUST use during the local-verify, ac-check, or verify phases before transitioning. Local verification pipeline execution and evidence collection. Use when transitioning from implement to local-verify, or when running the full verification suite for an issue.
---

**Announce at start:** "I am using the gxpm-verify skill to run the local verification pipeline in cost order, stop at the first failure, and record per-step evidence in the local-verify artifact before any phase advance."

# gxpm-verify

## When to trigger（入口条件）

在以下场景触发本 skill：

- `implement` 阶段完成，即将过渡到 `local-verify`
- 需要为某个 issue 运行完整验证套件
- 需要收集验证证据以推进工作流

`local-verify` artifact 不完整时禁止进入 `ac-check`。

## 可操作流程

### 验证流水线

按成本升序执行。**遇到第一个失败即停止。**

```
Step 1: git diff --check          (free — whitespace violations)
Step 2: bun run check             (fast — static analysis + typecheck + scaffold/cli/skill promises)
Step 3: bun test                  (medium — unit + integration tests)
Step 4: <project build>           (optional — only if the project defines a separate build step)
```

> Step 4 视项目而定：本仓库（gxpm 自身）没有独立的 `build` script，`bun run check` 已经包含编译 + 类型检查；其他下游项目若 `package.json scripts` 里确有 build 入口，再在此处追加该命令。

只运行与变更相关的步骤：
- Pure test changes: Steps 1–3 are sufficient.
- Build config or type changes: 全部相关步骤都要跑。
- Documentation only: Step 1 only.

### 证据收集

每步完成后记录：

```json
{
  "verificationSteps": [
    {
      "step": "git-diff-check",
      "command": "git diff --check",
      "exitCode": 0,
      "durationMs": 120,
      "summary": "no whitespace errors"
    },
    {
      "step": "typecheck",
      "command": "bun run check",
      "exitCode": 0,
      "durationMs": 1200,
      "summary": "42 files checked, 0 errors"
    },
    {
      "step": "test",
      "command": "bun test",
      "exitCode": 0,
      "durationMs": 4500,
      "summary": "156 passed, 0 failed"
    }
  ]
}
```

> 如果项目有独立的 build step，在 `verificationSteps` 末尾追加一条 `{ "step": "build", "command": "<project build cmd>", ... }`。本仓库 (gxpm) 因为 `bun run check` 已含编译验证，没有这一步。

### 失败时的 Skill 路由

某一步失败时，加载对应 skill 修复，禁止盲目修复：

| Failed step | Root cause likely | Load this skill |
|-------------|-------------------|-----------------|
| `git diff --check` | Whitespace / trailing space | Fix directly, re-run from Step 1 |
| `bun run check` | Type error, syntax error, scaffold/skill-promise drift | `/gxpm-build` |
| `bun test` | Test failure, regression, missing coverage | `/gxpm-tdd` |
| project build (if any) | Build script error, dependency issue | `/gxpm-build` |

**Do not fix blindly.** Load the relevant skill, follow its discipline, then re-run the full pipeline from Step 1.

## Red Flags（红旗清单 / 反模式）

- **No skips.** Every relevant step must execute and pass.
- **Evidence before transition.** `local-verify` artifact is incomplete without `verificationSteps`.
- **Re-run discipline:** Only re-run a step if the code has changed since the last run. Re-running on unchanged code adds no information.

## Verification（验证清单 / 出口条件）

完成 `local-verify` 必须满足：

- [ ] 所有相关步骤均已执行且通过（exit code 0）
- [ ] `local-verify` artifact 包含完整的 `verificationSteps` 数组
- [ ] 每步记录包含：step 名称、command、exitCode、durationMs、summary
- [ ] 如某步失败，已加载对应 skill 修复并重新运行完整流水线
- [ ] 代码自上次运行后如有变更，已重新执行全部相关步骤

在 gxpm 工作流中：
- 在 `implement → local-verify` 过渡时加载本 skill
- `local-verify` artifact 必须包含 `verificationSteps` 后才能推进到 `ac-check`
- 任何步骤失败，修复后必须从 Step 1 重新运行完整流水线

## Read Next

- `/gxpm-build` — compile verification
- `/gxpm-tdd` — test-first feedback loop
- `/gxpm-review-army` — multi-role review after verify

## Terminal State

完成本阶段验证 + 写完对应 artifact 后，按 currentPhase 选下一跳：

- `local-verify` → `gxpm issue transition <id> ac-check`，再次 invoke `gxpm-verify` 写 `acceptance-check` artifact。
- `ac-check` → `gxpm issue transition <id> self-review`，invoke `gxpm-review-changes` 写 `self-review`。
- `verify` → `gxpm issue transition <id> qa`，invoke `gxpm-browser` 写 `qa-findings`（runtime-only / 无 UI 改动时可记 N/A）。

跑 `gxpm issue next <id> --json` 看 `requiredArtifact` 和 `command` 确认下一步落点。
