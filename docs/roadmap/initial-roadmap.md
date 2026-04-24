# gxpm 初始路线图

## V0：替代型核心合同

- 定义 `.gxpm/issues/<issue-id>/` 状态、产物和 evidence store。
- 写出 gxpm 原生 phase guide 最小集合。
- 建立 PMC/gstack replacement map。
- 写出 capability runtime interface 文档。
- 让 `skills/gxpm/SKILL.md` 能指导代理按 gxpm state graph 路由。

## V0.1：Issue Runtime

- Linear issue 读取、同步、写回策略。
- 本地 state 优先级和冲突补偿。
- checkpoint helper。
- issue index 与 resume packet。
- PMC `.omc/pm` 迁移/import 策略。

## V0.2：Execution 与 Verification Runtime

- local-verify/ac-check/verify/qa artifact schema。
- worker dispatch、worktree、claim、handoff。
- review/self-review/adversarial review contract。
- QA evidence bundle：截图、console、network、route、commit。

## V0.3：Browser Runtime

- gstack browse daemon 能力重构为 gxpm browser runtime。
- token、state file、tab/ref、console/network/screenshot 证据模型。
- browser QA 与 issue phase 的统一写回。

## V0.4：Release Runtime

- PR body、changelog、version、branch hygiene。
- ship、pr-check、land 的统一 release policy。
- merge/deploy handoff gate。

## V1：gxpm skill runtime

- 模板生成 `SKILL.md`。
- host abstraction：Codex、Claude、OpenClaw/其他 agent。
- context recovery、timeline、learn。
- 配置系统和 team init。
- gstack skill preamble 能力重构为 gxpm preflight/runtime。

## 长期方向

- 项目级 dashboard。
- 多 issue dependency graph。
- 自动 overlap/directional scan。
- 验证 profile 与风险级别自适应。
- 跨工具/跨 agent 的统一 artifact viewer。
- PMC/gstack 迁移命令与弃用计划。
