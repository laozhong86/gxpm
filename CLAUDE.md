# gxpm

本项目的代理规则以 `AGENTS.md` 为准。Claude Code 会话也应先读取并遵守同目录 `AGENTS.md`。

## Skill routing

- `/pm`、Linear issue、triage、plan、dispatch、verify、qa、land 相关任务：把 PMC 作为能力来源研究，但以 gxpm replacement architecture 为最终真值。
- browser QA、review、ship、investigate、design/devex 相关能力：把 gstack 作为能力来源研究，但要重构为 gxpm 原生模块。
- 不要把 gxpm 写成 PMC/gstack 的 wrapper；目标是二代产品完全替代。
