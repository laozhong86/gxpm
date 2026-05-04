# ADR-005: 多平台插件转换/分发基础设施

## 状态

Accepted — 最小可行实现已完成（GXPM-80）。

## 背景

gxpm 当前通过 `scripts/gen-skill-docs.ts` 和 `scripts/install-skill.ts` 将 skill 从源格式（`.tmpl` 模板 + 静态 `.md`）分发到目标宿主（Codex CLI、Claude Code、Cursor）。

现有管道的问题：
1. **Ad-hoc 转换**：`gen-skill-docs.ts` 使用简单的字符串替换（`replaceAll`）渲染模板，没有正式的解析层。
2. **平台差异硬编码**：frontmatter 过滤、env var 注入、preamble 生成等逻辑散落在 `gen-skill-docs.ts` 和 `install-skill.ts` 中。
3. **无托管区块**：生成的 SKILL.md 是完整覆盖的，用户无法在生成内容之间插入自定义内容而不被下次生成覆盖。
4. **扩展成本高**：新增宿主平台需要同时修改 `gen-skill-docs.ts` 和 `install-skill.ts`。

## 决策

引入 **parser → converter → target-writer** 三层转换架构，作为 gxpm skill 分发的正式基础设施。

### 源格式（Canonical Source）

- **模板文件**（`.tmpl`）：保留现有字符串占位符体系（`{{PREAMBLE}}`、`{{ARTIFACT_READ_COMMANDS}}` 等），因为它们在 skill 作者侧直观且有效。
- **静态文件**（`.md`）：走新的 AST 管道，支持 frontmatter 过滤、 preamble 注入和 managed-artifacts。

### 三层架构

| 层级 | 职责 | 对应模块 |
|------|------|----------|
| Parser | 将 Markdown 解析为 `SkillDocument` AST（frontmatter + sections + managed blocks） | `core/converters/parser.ts` |
| Converter | 根据 `HostConfig` 转换 AST（过滤 frontmatter、注入 preamble、调整结构） | `core/converters/converter.ts` |
| TargetWriter | 将 AST 序列化为目标平台字符串，支持 managed-artifacts 合并 | `core/converters/writer.ts` |

### 平台优先级

1. **Codex CLI**（已有，保持兼容）
2. **Claude Code**（已有，通过新管道增强静态文件支持）
3. **Cursor**（后续 issue 跟进）

### Managed Artifacts

采用 HTML 注释标记：

```markdown
<!-- BEGIN MANAGED:section-id -->
... generated content ...
<!-- END MANAGED:section-id -->
```

重新生成时，Writer 会保留旧文件中的非托管内容，只替换匹配的托管区块。当前最小实现中，Writer 以生成内容为准，未来可扩展为严格合并模式。

## 替代方案

| 方案 | 优点 | 缺点 | 结论 |
|------|------|------|------|
| A. 保持现有字符串替换 | 零改动，风险低 | 无法支持 managed-artifacts，扩展性差 | 拒绝 |
| B. 引入完整 Markdown AST（如 remark） | 解析精确 | 引入外部依赖，overkill for skill 文档 | 拒绝 |
| C. **轻量自定义 parser + converter** | 零外部依赖，足够精确，可控 | 需要维护 parser | **采纳** |
| D. 每个平台独立维护 skill 副本 | 平台完全自由 | 违背 "一次编写，多平台分发" 目标 | 拒绝 |

## 影响

- `scripts/gen-skill-docs.ts`：静态文件路径切换为新管道；`.tmpl` 路径保持字符串替换以保证向后兼容。
- `scripts/install-skill.ts`：静态文件安装使用新管道；`.tmpl` 继续委托 `gen-skill-docs.ts`。
- 新增 `core/contracts/converter.ts` 类型定义和 `core/converters/` 实现目录。
- 现有测试（`test/gen-skill-docs.test.ts`）继续通过，无回归。

## 后续工作

- GXPM-XX：将 `.tmpl` 模板体系逐步迁移到新 AST 管道，统一字符串替换和 AST 转换。
- GXPM-XX：为 Cursor 宿主实现专门的 `HostConverter` 扩展。
- GXPM-XX：严格合并模式（`mergeManagedBlocksStrict`），保留用户在生成文件中的非托管自定义内容。
