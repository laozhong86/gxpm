# gxpm Agent Contract

## Role

gxpm 是面向完全替代 `pmc` 和 `gstack` 的第二代代理项目管理产品。PMC 和 gstack 是上游研究对象与能力来源，不是 gxpm 的长期运行依赖。

<!-- BEGIN USER-SPECIFIED -->
gxpm 不是 PMC 的兼容壳，也不是 gstack 的插件集合。所有设计都要服务于独立产品闭环：统一 state graph、capability runtime、browser evidence、review/ship governance 和 agent execution loop。
<!-- END USER-SPECIFIED -->

## 全局纪律

**所有 Agent 在所有阶段都必须遵守 `CANON.md` 中的行为宪法。** 本文档不再重复那些纪律，只保留项目级入口信息。

## Truth Sources

1. 用户本轮明确指令。
2. `CANON.md` — 全局行为宪法
3. `CONTEXT.md` — 共享语言/术语表
4. `docs/architecture/gxpm-replacement-architecture.md`
5. `docs/architecture/gxpm-v0-contract.md`
6. `docs/architecture/scaffold-northstar.md`
7. `docs/governance/development-contract.md`
8. `docs/governance/template-authoring.md`
9. `docs/governance/host-adapter.md`
10. `docs/governance/skill-authoring.md`
11. `docs/research/pmc-gstack-skill-study.md`

如果来源冲突，先指出冲突和建议的最小安全路径。

## Reference Projects（工程实践优先参考）

以下项目作为 gxpm 工程实践与 skill 设计的参考借鉴对象，本地路径如下：

- **obra/superpowers** — 代理能力编排与权限管理参考  
  路径：`/Users/x/Desktop/Project/github/superpowers`
- **garrytan/gstack** — 全栈 Agent 工具链与部署实践参考  
  路径：`/Users/x/Desktop/Project/github/gstack`
- **affaan-m/everything-claude-code** — Claude Code 扩展生态与 skill 模式参考  
  路径：`/Users/x/Desktop/Project/github/everything-claude-code`
- **Yeachan-Heo/oh-my-codex** — Codex CLI 工作流与 hook 设计参考  
  路径：`/Users/x/Desktop/Project/github/oh-my-codex`
- **mattpocock/skills** — Skill 结构与类型驱动开发实践参考  
  路径：`/Users/x/Desktop/Project/github/mattpocock-skills`
- **ZeroZ-lab/unified-skills** — 四层分离制度架构参考  
  路径：`/Users/x/Desktop/Project/github/unified-skills`

## gxpm Config

- worktree.enforcement: required
- worktree.default: ask

如需禁用 worktree，改为 `forbidden`。任何 `.gxpm/config.json` 中显式设置都会覆盖本段。

## Commands

```bash
bun test
bun run gen:skill-docs
bun run check
```

## Progressive Docs

- 全局纪律：`CANON.md`
- 开发、验证、提交：`docs/governance/development-contract.md`
- skill 模板写法：`docs/governance/template-authoring.md`
- host adapter 扩展：`docs/governance/host-adapter.md`
- 产品架构：`docs/architecture/`
- 上游研究：`docs/research/`
