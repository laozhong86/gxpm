# AGENTS.md - gxpm

## 项目定位

gxpm 是以 `pmc` skill 为核心的第二代项目管理代理框架。
它保留 PMC 在 Linear、阶段状态、交付门禁和产物持久化上的优势，
同时吸收 gstack 的技能框架、浏览器验证、评审流水线、上下文恢复和自学习能力。

## 当前阶段

本仓库处于初始化和架构收敛阶段。默认先维护项目真值文档、研究结论和合同边界，
不要急于生成完整 runtime 或复制现有 skill 树。

## 工作原则

- 全程中文沟通，汇报要包含路径、命令和验证证据。
- 先读现有文件和相关外部 skill 真值，再修改本仓库。
- gxpm 不复制 PMC 已经定义清楚的阶段细节；它应做编排、路由、门禁、状态和能力聚合。
- gstack 能力只吸收框架思想和必要实现模式，不做大段 vendoring。
- 任何 Linear 相关设计都必须把 Linear 当作协作前门，而不是执行器。
- 任何 browser/QA 相关设计都必须有可复核证据路径，不能只写“已测试”。
- destructive cleanup、发布、合并、远端写操作必须先确认边界。

## 真值优先级

1. 本仓库 `docs/architecture/gxpm-v0-contract.md`
2. 本仓库 `docs/research/pmc-gstack-skill-study.md`
3. 当前本机技能源码：
   - `/Users/x/.agents/skills/pmc`
   - `/Users/x/.claude/skills/gstack`
   - `/Users/x/.codex/skills/gstack`
4. 用户本轮明确指令

如果这些来源冲突，先指出冲突并给出最小可执行建议。

## 预期交付形态

- `skills/gxpm/SKILL.md`：未来 gxpm skill 的入口合同。
- `docs/architecture/`：状态机、能力边界、运行时设计。
- `docs/research/`：对 PMC、gstack 和相邻项目的调查记录。
- `docs/roadmap/`：分阶段路线，不把 V1/V2 混成一个大球。

## 初始化后的下一步

优先补齐：

1. gxpm 与 pmc 的 phase/state 兼容层。
2. gstack-style preamble、context recovery、learn/report 机制的最小设计。
3. browser QA 能力与 PMC `qa` phase 的契约对接。
4. Linear 同步与本地状态写回的幂等策略。
