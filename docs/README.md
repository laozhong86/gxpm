# gxpm 文档体系

本文档目录采用结构化分类模式，确保工程决策、最佳实践和平台规范可跨会话恢复。

## 目录结构

```
docs/
├── README.md                          # 本文件：文档体系导航
├── brainstorms/                       # 需求文档与问题探索
│   ├── README.md
│   └── *-requirements.md
├── plans/                             # 实现计划与技术方案
│   ├── README.md
│   └── *-plan.md
├── solutions/                         # 最佳实践、恢复手册、决策记录
│   ├── README.md
│   └── *.md（含 frontmatter）
├── specs/                             # Host 平台规范镜像
│   ├── README.md
│   └── claude.md / codex.md / cursor.md
├── architecture/                      # 架构设计文档（存量）
├── governance/                        # 治理契约与规范（存量）
├── research/                          # 上游研究与调研（存量）
├── roadmap/                           # 产品路线图（存量）
├── migrations/                        # 迁移指南（存量）
├── agents/                            # Agent 相关文档（存量）
├── GXPM_VERIFY.md                     # 验证清单
└── INSTALL_FOR_AGENTS.md              # 代理安装指南
```

## 快速导航

| 场景 | 目标目录 |
|------|----------|
| 新功能需求探索 | `docs/brainstorms/` |
| 制定实现计划 | `docs/plans/` |
| 记录故障恢复步骤 | `docs/solutions/` |
| 查看 host 平台约束 | `docs/specs/` |
| 理解系统设计 | `docs/architecture/` |
| 查阅开发规范 | `docs/governance/` |

## 新会话恢复上下文

1. 读取 `AGENTS.md`（项目根目录）— 代理契约
2. 读取 `CONTEXT.md`（项目根目录）— 共享术语表
3. 按需查阅 `docs/solutions/` — 工程决策与恢复手册
4. 按需查阅 `docs/specs/<host>.md` — 当前 host 平台规范
5. 运行 `./bin/gxpm issue list` — 查看当前 issue 状态

## 维护约定

- **solutions/** 文档必须包含 YAML frontmatter（title, category, date, severity, component, tags）
- **brainstorms/** 采用 `*-requirements.md` 命名
- **plans/** 采用 `*-plan.md` 命名
- 每次重大决策后同步更新 solutions/
- 每次 host 适配变更后同步更新 specs/
