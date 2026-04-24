# gxpm Claude Bootstrap

本文件只承担 Claude Code 的薄启动层。共享执行合同以 `AGENTS.md` 为准。

## Load Order

1. 先读 `AGENTS.md`。
2. 涉及开发规范时读 `docs/governance/development-contract.md`。
3. 涉及 skill 文档或 prompt 模板时读 `docs/governance/template-authoring.md`。
4. 涉及 Codex/Claude/未来 host 输出时读 `docs/governance/host-adapter.md`。

## Claude-Specific Notes

- 不要把 `/pm` 当 gxpm 的最终入口；PMC 只作为上游参考。
- 不要把 `/qa`、`/review`、`/ship` 的 gstack 实现直接 vendoring 到 gxpm；先抽象为 gxpm capability。
- 如果本地 `.claude/` 未来被脚手架生成或 symlink 到工作区，先确认 live install 风险，再改模板或生成器。
