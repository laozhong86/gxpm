---
name: gxpm-eval
type: discipline
description: Skill quality evaluation harness for static analysis. Use when adding a new skill, modifying skill structure, auditing skill quality, or checking for governance compliance.
---

**Announce at start:** "I am using the gxpm-eval skill to audit a skill for governance compliance and structural quality using the static analysis harness."

# gxpm-eval

Lightweight static analysis for gxpm skills. Checks frontmatter completeness,
trigger sections, description quality, and reference links.

## When to trigger（入口条件）

- After creating or modifying a skill
- During `self-review` or `qa` phase before shipping skill changes
- When `bun run check` reports skill doc drift

## 可操作流程

### 命令

```bash
gxpm-eval list                         # list all discoverable skills
gxpm-eval run                          # eval all skills
gxpm-eval run gxpm-diagnose            # eval one skill
gxpm-eval run --json                   # machine-readable output
```

### 评分标准

Each skill is scored on 9 dimensions. Pass threshold: ≥ 60%.

#### Universal checks (all skill types)

| Check | Points | Pass criteria |
|-------|--------|---------------|
| frontmatter | 10 | Has YAML `---` block |
| name | 10 | `name:` field present and non-empty |
| description | 10 | 20-300 characters **and** contains "Use when" trigger phrase |
| triggers | 10 | Has `## When to trigger` or `## Commands` |
| length | 10 | 10-1000 lines (warn if >100 without `references/`) |
| references | 10 | Has `## Read Next` or `## References` |

#### Type-specific checks

| Check | Points | Pass criteria |
|-------|--------|---------------|
| **Discipline** skills | 10 | Has `## Red Flags` AND `## Rationalization Table` AND explicit negation (`**No exceptions:**`) |
| **Pattern** skills | 10 | Has `## Recognition criteria` AND `## When NOT to apply` AND `## Counter-examples` |
| **Reference** skills | 10 | Has concrete command examples with expected output |

A skill missing its type-specific structures loses the full 10 points for that dimension.

### 集成到 CI

Add to `gxpm-check` or CI:

```bash
bun run scripts/eval.ts run --json
```

## Red Flags（红旗清单 / 反模式）

- 不要依赖 gxpm-eval 做 LLM 输出质量评分 — 它只做静态结构分析
- 不要假设结构通过 = 内容正确 — eval 不验证 skill 内容的正确性
- 不要在未通过 ≥ 60% 阈值时将 skill 标记为就绪

## Foundational Principle

> Violating the letter of the eval contract — even with good intent — is treated as a failure. A skill that scores 100% on rubric but fails real triggering is still a regression: the structural contract is the public surface that downstream CI and host loaders trust. **No exceptions:** if you must change the contract, change the eval first, never silently route around it.

## Rationalization Table

| Excuse | Reality |
|---|---|
| "It's only a small skill, the structure doesn't matter." | Host loaders use the same regex regardless of skill size; missing `## When to trigger` blocks discovery for users. |
| "The Chinese heading conveys the same meaning." | The eval regex is byte-literal; semantic equivalence is invisible. Rename to bilingual or add an English alias. |
| "I'll fix the structure later, after content is right." | Content with no contract is invisible. Ship the contract first, polish content next. |
| "60% is the pass threshold, I'm at 60%." | 60% means "barely loadable," not "ready." Discipline skills should target ≥ 90% before merge. |
| "It passes locally, CI will catch the rest." | CI runs the same eval. If it passes locally, the only thing CI adds is publication of the failure. |

## Verification（验证清单 / 出口条件）

- [ ] 所有 discoverable skills 已列入评估结果
- [ ] 每个 skill 在 9 个维度上的得分已计算
- [ ] 总分达到 ≥ 60% 阈值
- [ ] type-specific checks 已按 skill 类型正确匹配
- [ ] `bun run scripts/eval.ts run --json` 输出可被下游 CI 消费

## Read Next

- `docs/governance/skill-authoring.md`
- Main `/gxpm` skill for skill toolchain overview
