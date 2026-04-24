# gxpm 脚手架北极星

gxpm 把 gstack 当作脚手架北极星，而不是运行时依赖。需要保留的是它的产品化形态：

- 用模板定义可安装的 agent-facing surface。
- 用 host adapter 显式描述每个代理运行时。
- 用生成器从模板产出可检查的 skill 文档。
- 用本地检查在生成产物漂移时 fail fast。
- 用 CLI 入口把项目做成可安装、可升级、可团队化的产品。

## V0 合同

初始脚手架刻意保持小而完整：

- `hosts/` 把 Codex 和 Claude Code 注册成一等 host adapter。
- `scripts/discover-skills.ts` 发现 `SKILL.md.tmpl`，同时跳过生成目录、隐藏目录和构建产物。
- `scripts/gen-skill-docs.ts` 用 host-aware preamble 渲染模板。
- `scripts/gxpm-check.ts` 校验 host 合同和生成文档。
- `bin/` 暴露稳定命令名，为后续 install/update/team-init 流程留入口。

这会先给 gxpm 建立产品脊柱，再继续生长 PM state graph。下一层可以补 `.gxpm`
状态、capability 执行、browser evidence 和 Linear sync，而不需要重写安装面。
