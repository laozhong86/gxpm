# gxpm

gxpm 是面向完全替代 PMC 和 gstack 的第二代代理项目管理产品。

它不是 PMC 的兼容壳，也不是 gstack 的插件集合。gxpm 会系统吸收两者已经证明有效的能力，然后重构成一个统一的产品架构：

- 从 PMC 继承 Linear-first 项目管理、issue phase、状态门禁、交付产物和可恢复执行。
- 从 gstack 继承技能框架、浏览器 runtime、QA/review/ship/investigate 流水线、上下文恢复、自学习和团队化安装。
- 在 gxpm 中重新定义统一的 state graph、capability runtime、agent execution loop、browser evidence layer 和 release governance。

最终目标：gxpm 可以独立承担 PMC 和 gstack 当前覆盖的核心工作流，并提供更统一、更可维护、更适合代理执行的二代控制面。

## 初始化产物

- `AGENTS.md`：本仓库代理规则。
- `package.json`：Bun/TypeScript 脚手架入口。
- `hosts/`：Codex 与 Claude Code 的 host adapter 注册。
- `scripts/`：skill 模板发现、生成和脚手架检查。
- `bin/`：未来安装/升级/检查命令的稳定入口。
- `docs/governance/`：代理开发规范、模板写法和 host adapter 治理。
- `docs/research/pmc-gstack-skill-study.md`：PMC 与 gstack 的调查结论。
- `docs/architecture/gxpm-replacement-architecture.md`：替代型二代架构。
- `docs/architecture/gxpm-v0-contract.md`：gxpm V0 合同与边界。
- `docs/architecture/scaffold-northstar.md`：借鉴 gstack 的脚手架北极星。
- `docs/roadmap/initial-roadmap.md`：初始路线图。
- `skills/gxpm/SKILL.md.tmpl`：gxpm skill 模板真值。
- `skills/gxpm/SKILL.md`：由模板生成的 gxpm skill 入口。

## 本地命令

```bash
bun test
bun run gen:skill-docs
bun run check
bin/gxpm issue create local-demo
bin/gxpm issue status local-demo
bin/gxpm workspace plan local-demo
bin/gxpm run list local-demo
bin/gxpm orchestrator tick --dry-run
bin/gxpm artifact list local-demo
bin/gxpm artifact read local-demo acceptance-contract
```

完整 phase gate 命令由 `skills/gxpm/SKILL.md` 生成，真值来自 `core/phase-gates.ts`。

## 当前边界

当前已具备脚手架、host adapter、生成检查、`.gxpm` state graph、phase artifact gate、checkpoint/resume、原生 wiki init/update/query/context/eval，以及第一批 execution runtime 原语：run ledger、workspace runtime 和只读 orchestrator dry-run。下一步应继续把 PMC/gstack 能力拆成 gxpm 原生模块，并围绕 V0 最小替代闭环补齐真实 agent run、browser evidence 和 release governance。
