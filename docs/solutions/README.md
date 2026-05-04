# docs/solutions/

最佳实践、故障恢复手册与工程决策记录的存放目录。

## 命名规范

采用描述性命名，建议包含组件或场景前缀：

- `component-name-recovery.md` — 故障恢复手册
- `pattern-name-practice.md` — 最佳实践
- `decision-name-adr.md` — 架构决策记录

## Frontmatter 标准

每份文档必须以 YAML frontmatter 开头：

```yaml
---
title: "文档标题"
category: "recovery | practice | decision | playbook"
date: "YYYY-MM-DD"
severity: "critical | high | medium | low | info"
component: "组件名或 *"
tags: ["tag1", "tag2"]
---
```

### 字段说明

| 字段 | 说明 |
|------|------|
| `title` | 文档标题，简洁明确 |
| `category` | 文档类型：recovery（恢复）、practice（实践）、decision（决策）、playbook（手册） |
| `date` | 创建或最后更新日期 |
| `severity` | 问题严重程度或重要性 |
| `component` | 相关组件名，跨组件用 `*` |
| `tags` | 便于检索的标签数组 |

## 内容约定

- 场景描述（Context）
- 症状或触发条件（Symptoms / Triggers）
- 解决步骤（Resolution Steps），编号列表
- 预防措施（Prevention）
- 相关链接（References）
