# gxpm 行为宪法

> CANON.md 是 gxpm 的最高行为合同。它不描述某个具体技能怎么做，而是规定所有 Agent 在所有阶段都必须遵守的纪律。

## 1. 真值优先

先读本仓库真值和相关上游 skill/source，再改文件。来源冲突时，先指出冲突和建议的最小安全路径。

## 2. Issue 驱动

任何非平凡代码改动开始前，确认有对应 GXPM-N issue 处于正确阶段；否则先 `gxpm issue create --auto-id` 并走完 triage → plan → dispatch。

## 3. Phase 不可臆测

不从聊天记忆推断 phase 或完成状态。不确定下一步时，统一查 `gxpm issue next <id>`，不要自己拼 CLI。

## 4. Artifact 先决

Phase 推进前先写完 artifact，再 `gxpm issue transition`。不要直接编辑 `.gxpm/issues/<id>/*.json`，统一通过 `gxpm artifact write` / `gxpm artifact edit`。

## 5. 设计落盘

方案、取舍、替代选项必须写到对应 artifact（triage-report / implementation-plan / ADR 等），不能只留在聊天里。下一个会话只读 `.gxpm/issues/<id>/` 也能恢复上下文是底线。

## 6. 生成物纪律

编辑 skill 时改 `*.tmpl`，再运行 `bun run gen:skill-docs`。生成物冲突只能通过模板和生成器解决，再重新生成。不手改生成产物当真值。

## 7. Worktree 隔离

进入 implement 前 `git status -sb` 检查未追踪文件；如有 3+ 个来源不明文件，默认走独立 worktree 隔离。`git worktree add` 之后必须 `cd` 进新 worktree 才能动代码。

## 8. 证据可复核

browser/QA/review/ship 相关结论必须落到可复核证据。汇报包含路径、命令和验证证据。

## 9. 安全门控

destructive cleanup、发布、合并、远端写操作前必须确认。不把 gxpm 写成 PMC/gstack wrapper，不引入 PMC/gstack 运行时依赖。不做 yes-machine。

## 10. 失败归因

不声称历史失败与本次无关，除非有 base/main 对照证据或仓库已有记录证明该失败是基线噪声。

## 约束层级

```text
CANON.md
  ├─ 约束 Command：阶段不能跳过必要门控
  ├─ 约束 Agent：角色不能越权自证通过
  ├─ 约束 Skill：技能只能增加纪律，不能放松宪法
  └─ 约束 Artifact：产物必须留下可审计证据
```
