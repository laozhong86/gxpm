---
name: gxpm-build
type: reference
description: Compile and type-check verification. Use after implementing code changes, before committing, or when the build fails and root cause is unclear.
---

**Announce at start:** "I am using the gxpm-build skill to run the compile and type-check verification pipeline and surface the first failing root cause cleanly."

# gxpm-build

## When to trigger（入口条件）

在以下场景触发本 skill：

- 每次代码变更后，需要确认编译和类型检查通过
- 提交前，作为 `gxpm-verify` 的前置步骤之一
- 构建失败且根因不明确时

**Skill 边界**：本 skill 仅处理编译和类型检查层面的验证。测试失败请加载 `/gxpm-tdd`，代码风格或提交规范请加载 `/gxpm-hygiene`。

在 gxpm 工作流中，`implement` 阶段每次完成一个垂直切片后都应运行构建验证。离开 `implement` 前，`local-verify` artifact 的 `commands` 数组必须包含一次构建/类型检查命令及其退出码。

## 可操作流程

执行编译/类型检查验证：

```bash
bun run check
```

> 本仓库 `package.json` 没有独立的 `build` script——`bun run check` 即是编译 + 类型检查的入口（实际调用 `scripts/gxpm-check.ts`）。如果在其他项目使用本 skill，把 `bun run check` 替换为该项目等效的"类型检查 / 编译验证"命令；如果项目另有独立 `build` 步骤，再追加一次执行。

### 退出码约定

| Exit Code | Meaning | Action |
|-----------|---------|--------|
| 0 | Success | Proceed |
| non-0 | Failure | **Stop. Fix before continuing.** |

### 构建失败归因

遇到构建失败时，按症状定位根因并选择修复策略：

| Symptom | Likely Cause | Fix Strategy |
|---------|-------------|--------------|
| Type error in changed file | Incorrect type usage or missing property | Fix the type, not the test |
| Type error in unchanged file | Breaking change leaked to consumer | Update consumer or revert breaking change |
| Syntax error | Typo, missing brace, invalid syntax | Fix syntax, re-run typecheck first |
| Build output missing | Build script misconfigured or dependency missing | Check `package.json` scripts and `node_modules` |
| Module resolution error | Import path wrong or alias unconfigured | Verify path mapping in `tsconfig.json` |

## Red Flags（红旗清单 / 反模式）

- **Never commit broken build.** A build failure means implementation is incomplete.
- **Type errors are behavior errors.** Type checking is not optional polish — it is contract verification.
- **Incremental compilable:** After every increment (even partial), the project must build successfully.
- **One fix at a time:** If build fails, fix the root cause before running the build again. Do not guess-and-rerun.

## Verification（验证清单 / 出口条件）

构建通过的标准：

- [ ] `bun run check` 返回 exit code 0（在其他项目里换成等效的类型检查 / 编译命令）
- [ ] 如失败，已定位根因并完成单次修复（禁止猜测-重跑循环）

`local-verify` artifact 的真实 schema（来自 `core/implement.ts` + `core/artifact-validator.ts:60`）要求顶层字段：`status / changedFiles / commands / evidence / results / risks / verificationLog`。本 skill 负责往 `commands` 和 `results` 数组追加一条构建记录（与测试、其他验证步骤的记录共存），不要写不存在的 `buildEvidence` 顶层字段。

最小示例（用 `gxpm artifact write/edit` 提交）：

```json
{
  "status": "draft",
  "commands": [
    { "label": "build", "cmd": "bun run check", "exitCode": 0, "ranAt": "2026-05-22T08:30:00Z" }
  ],
  "results": [
    { "label": "build", "ok": true, "summary": "type-check passed" }
  ]
}
```

## Read Next

- `/gxpm-verify` — local verification pipeline
- `/gxpm-hygiene` — pre-commit hygiene
