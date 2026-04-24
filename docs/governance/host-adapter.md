# gxpm Host Adapter Governance

## 目的

gxpm 借鉴 gstack 的声明式 host config：新增代理 host 应该主要新增配置，而不是把 per-host 分支写进生成器、setup 或检查脚本。

## 当前 host

- `claude`：Claude Code。
- `codex`：OpenAI Codex CLI。

注册入口：

- `hosts/<name>.ts`
- `hosts/index.ts`
- `scripts/host-config.ts`

## 新增 host 流程

1. 新建 `hosts/<name>.ts`，导出 `HostConfig`。
2. 在 `hosts/index.ts` 注册。
3. 在 `.gitignore` 增加该 host 的生成目录。
4. 运行 `bun run gen:skill-docs --host <name>`。
5. 运行 `bun test` 和 `bun run check`。
6. 如 host 需要不同工具语义，先设计 adapter，再接入生成器。

## Config 最小字段

每个 host 必须声明：

- `name`
- `displayName`
- `cliCommand`
- `hostSubdir`
- `globalRoot`
- `localSkillRoot`
- `usesEnvVars`
- `frontmatter`
- `install.strategy`

## 设计规则

- path、frontmatter、tool rewrite、suppressed section 都应来自 host config。
- generator 不应包含散落的 `if host === ...` 业务分支；复杂差异用 adapter。
- host 输出必须避免其他 host 路径泄漏，例如 Codex 输出不应残留 `.claude/skills`。
- 新增 host 后，参数化测试应自动覆盖它；如果不能自动覆盖，先补测试基础设施。

## 验证目标

`validateAllConfigs()` 至少检查：

- host name 格式。
- CLI command 格式。
- path 安全性。
- frontmatter mode 合法性。
- name、hostSubdir、globalRoot 不重复。
