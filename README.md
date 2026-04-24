# gxpm

gxpm 是一个以 PMC 为核心、吸收 gstack 框架能力的第二代项目管理代理项目。

目标不是重写 PMC，也不是复制 gstack。gxpm 的目标是把两者的强项收束成一个更完整的代理项目管理控制面：

- PMC 提供 Linear 集成、阶段状态、交付门禁、持久化产物和 issue lifecycle。
- gstack 提供技能框架、浏览器验证、评审/QA/ship 流水线、上下文恢复、自学习和工具 runtime 设计。
- gxpm 把这些能力组合为面向代理执行的项目管理系统。

## 初始化产物

- `AGENTS.md`：本仓库代理规则。
- `docs/research/pmc-gstack-skill-study.md`：PMC 与 gstack 的调查结论。
- `docs/architecture/gxpm-v0-contract.md`：gxpm V0 合同与边界。
- `docs/roadmap/initial-roadmap.md`：初始路线图。
- `skills/gxpm/SKILL.md`：gxpm skill 入口草案。

## 当前边界

当前只初始化项目真值和设计基线，不实现 runtime。下一步应先从兼容 PMC 的状态与产物合同开始，而不是直接做大而全的命令系统。
