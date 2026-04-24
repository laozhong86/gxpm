# gxpm Agent Contract

## Role

gxpm 是面向完全替代 `pmc` 和 `gstack` 的第二代代理项目管理产品。PMC 和 gstack 是上游研究对象与能力来源，不是 gxpm 的长期运行依赖。

<!-- BEGIN USER-SPECIFIED -->
gxpm 不是 PMC 的兼容壳，也不是 gstack 的插件集合。所有设计都要服务于独立产品闭环：统一 state graph、capability runtime、browser evidence、review/ship governance 和 agent execution loop。
<!-- END USER-SPECIFIED -->

## Truth Sources

1. 用户本轮明确指令。
2. `docs/architecture/gxpm-replacement-architecture.md`
3. `docs/architecture/gxpm-v0-contract.md`
4. `docs/architecture/scaffold-northstar.md`
5. `docs/governance/development-contract.md`
6. `docs/governance/template-authoring.md`
7. `docs/governance/host-adapter.md`
8. `docs/research/pmc-gstack-skill-study.md`

如果来源冲突，先指出冲突和建议的最小安全路径。

## Always

- 全程中文沟通，汇报包含路径、命令和验证证据。
- 先读本仓库真值和相关上游 skill/source，再改文件。
- 编辑 skill 时改 `*.tmpl`，再运行 `bun run gen:skill-docs`；不要手改生成产物当真值。
- 把 Linear 当协作前门，把 `.gxpm` 本地 state/artifacts 当未来执行真值。
- browser/QA/review/ship 相关结论必须能落到可复核证据。
- 新增 host、skill、生成规则时同步补测试或检查入口。

## Ask First

- destructive cleanup、发布、合并、远端写操作。
- 改变 gxpm 产品定位、phase 集合、state 真值优先级。
- 引入 PMC/gstack 运行时依赖，而不是作为迁移/研究来源。
- 需要付费 eval、外部 API、长时间浏览器/E2E 验证。

## Never

- 不把 gxpm 写成 PMC/gstack wrapper。
- 不从聊天记忆推断 phase 或完成状态。
- 不把 generated `SKILL.md` 冲突用“接受某一边”解决。
- 不声称历史失败与本次无关，除非有 base/main 对照证据。
- 不把大段项目结构或可由代码推断的信息塞回默认加载文件。

## Commands

```bash
bun test
bun run gen:skill-docs
bun run check
```

## Progressive Docs

- 开发、验证、提交：`docs/governance/development-contract.md`
- skill 模板写法：`docs/governance/template-authoring.md`
- host adapter 扩展：`docs/governance/host-adapter.md`
- 产品架构：`docs/architecture/`
- 上游研究：`docs/research/`
