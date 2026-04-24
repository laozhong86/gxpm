# gxpm 初始路线图

## V0：合同和兼容层

- 定义 `.gxpm/issues/<issue-id>/` 状态与产物目录。
- 写出 phase guide 最小集合。
- 建立 PMC artifact compatibility map。
- 写出 ability adapter interface 文档。
- 让 `skills/gxpm/SKILL.md` 能指导代理按状态路由。

## V0.1：Linear 与本地状态

- Linear issue 读取、同步、写回策略。
- 本地 state 优先级和冲突补偿。
- checkpoint helper。
- issue index 与 resume packet。

## V0.2：验证与 QA

- local-verify/ac-check/verify/qa artifact schema。
- browser adapter contract。
- gstack browser 能力接入策略。
- QA evidence bundle：截图、console、network、route、commit。

## V0.3：评审与交付

- review adapter：structured review、specialist review、adversarial review。
- ship adapter：PR body、changelog、version、branch hygiene。
- land handoff：默认交给 merge/deploy 专用 skill，不在 gxpm 内硬写。

## V1：gxpm skill runtime

- 模板生成 `SKILL.md`。
- host abstraction：Codex、Claude、OpenClaw/其他 agent。
- context recovery、timeline、learn。
- 配置系统和 team init。

## 长期方向

- 项目级 dashboard。
- 多 issue dependency graph。
- 自动 overlap/directional scan。
- 验证 profile 与风险级别自适应。
- 跨工具/跨 agent 的统一 artifact viewer。
