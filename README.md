# gxpm

gxpm 是面向完全替代 PMC 和 gstack 的第二代代理项目管理产品。

它不是 PMC 的兼容壳，也不是 gstack 的插件集合。gxpm 会系统吸收两者已经证明有效的能力，然后重构成一个统一的产品架构：

- 从 PMC 继承 Linear-first 项目管理、issue phase、状态门禁、交付产物和可恢复执行。
- 从 gstack 继承技能框架、浏览器 runtime、QA/review/ship/investigate 流水线、上下文恢复、自学习和团队化安装。
- 在 gxpm 中重新定义统一的 state graph、capability runtime、agent execution loop、browser evidence layer 和 release governance。

最终目标：gxpm 可以独立承担 PMC 和 gstack 当前覆盖的核心工作流，并提供更统一、更可维护、更适合代理执行的二代控制面。

## 初始化产物

- `AGENTS.md`：本仓库代理规则。
- `docs/research/pmc-gstack-skill-study.md`：PMC 与 gstack 的调查结论。
- `docs/architecture/gxpm-replacement-architecture.md`：替代型二代架构。
- `docs/architecture/gxpm-v0-contract.md`：gxpm V0 合同与边界。
- `docs/roadmap/initial-roadmap.md`：初始路线图。
- `skills/gxpm/SKILL.md`：gxpm skill 入口草案。

## 当前边界

当前只初始化产品真值和架构基线，不实现 runtime。下一步应先把 PMC/gstack 能力拆成 gxpm 原生模块，再确定 V0 最小替代闭环。
