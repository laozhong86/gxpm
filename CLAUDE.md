# gxpm

本项目的代理规则以 `AGENTS.md` 为准。Claude Code 会话也应先读取并遵守同目录 `AGENTS.md`。

## Skill routing

- `/pm`、Linear issue、triage、plan、dispatch、verify、qa、land 相关任务：优先参考 PMC 语义，再回到 gxpm 本仓库合同。
- browser QA、review、ship、investigate、design/devex 相关能力：先研究 gstack 的对应 skill，再判断是否应被 gxpm 吸收。
- 不要把 gstack 的整个技能树 vendoring 到本仓库；只沉淀 gxpm 需要的接口、产物和最小实现。
