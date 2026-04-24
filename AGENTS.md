# AGENTS.md - gxpm

## 项目定位

gxpm 是面向完全替代 `pmc` 和 `gstack` 的第二代代理项目管理产品。
PMC 和 gstack 是上游研究对象与能力来源，不是 gxpm 的长期运行依赖。
gxpm 要重新规划统一架构，把项目管理、技能运行时、浏览器验证、评审交付、
上下文恢复和自学习收束成一个原生系统。

## 当前阶段

本仓库处于替代型架构规划阶段。默认先维护产品真值、能力拆解、架构合同和迁移路线，
不要把 gxpm 写成 PMC/gstack 的薄封装。

## 工作原则

- 全程中文沟通，汇报要包含路径、命令和验证证据。
- 先读现有文件和相关外部 skill 真值，再修改本仓库。
- gxpm 的目标是完整替代 PMC 和 gstack；所有设计都要服务于独立产品闭环。
- 先借鉴 PMC/gstack 的强能力，再重新命名、重组和产品化，不保留不必要的历史边界。
- 任何 Linear 相关设计都必须把 Linear 当作协作前门，而不是执行器。
- 任何 browser/QA 相关设计都必须有可复核证据路径，不能只写“已测试”。
- destructive cleanup、发布、合并、远端写操作必须先确认边界。

## 真值优先级

1. 本仓库 `docs/architecture/gxpm-replacement-architecture.md`
2. 本仓库 `docs/architecture/gxpm-v0-contract.md`
3. 本仓库 `docs/research/pmc-gstack-skill-study.md`
4. 当前本机技能源码：
   - `/Users/x/.agents/skills/pmc`
   - `/Users/x/.claude/skills/gstack`
   - `/Users/x/.codex/skills/gstack`
5. 用户本轮明确指令

如果这些来源冲突，先指出冲突并给出最小可执行建议。

## 预期交付形态

- `skills/gxpm/SKILL.md`：未来 gxpm skill 的入口合同。
- `docs/architecture/`：替代型产品架构、状态机、能力边界、运行时设计。
- `docs/research/`：对 PMC、gstack 和相邻项目的调查记录。
- `docs/roadmap/`：分阶段路线，不把 V1/V2 混成一个大球。

## 初始化后的下一步

优先补齐：

1. gxpm 原生 state graph 与 artifact store。
2. gxpm capability runtime：issue、plan、worker、review、browser、ship、learn。
3. PMC/gstack 能力映射到 gxpm 模块的 replacement map。
4. Linear 同步、本地状态写回和 browser evidence 的统一幂等策略。
