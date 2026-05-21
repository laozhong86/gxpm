---
name: gxpm-architecture
type: technique
description: Find deepening opportunities in a codebase using domain language and ADRs. Use when user wants to improve architecture, find refactoring opportunities, consolidate tightly-coupled modules, or make a codebase more testable and AI-navigable.
---

**Announce at start:** "I am using the gxpm-architecture skill to find deepening opportunities in this codebase using CONTEXT.md and ADRs, then suggest refactorings that consolidate coupling and improve AI-navigability."

# Improve Codebase Architecture

Surface architectural friction and propose **deepening opportunities** — refactors that turn shallow modules into deep ones. The aim is testability and AI-navigability.

## When to trigger（入口条件）

Load this skill when you see:
- User asks to "improve architecture", "refactor", "make this more testable", or "reduce coupling".
- A diagnosis surfaces an architectural root cause (tight coupling, shallow modules, missing seams).
- A new module is introduced during `self-review` and its depth is questionable.
- The codebase has grown and `CONTEXT.md` terms no longer map cleanly to file structure.

### 核心术语

Use these terms exactly in every suggestion:

- **Module** — anything with an interface and an implementation (function, class, package, slice).
- **Interface** — everything a caller must know to use the module: types, invariants, error modes, ordering, config. Not just the type signature.
- **Implementation** — the code inside.
- **Depth** — leverage at the interface: a lot of behaviour behind a small interface. **Deep** = high leverage. **Shallow** = interface nearly as complex as the implementation.
- **Seam** — where an interface lives; a place behaviour can be altered without editing in place.
- **Adapter** — a concrete thing satisfying an interface at a seam.
- **Leverage** — what callers get from depth.
- **Locality** — what maintainers get from depth: change, bugs, knowledge concentrated in one place.

Key principles:

- **Deletion test**: imagine deleting the module. If complexity vanishes, it was a pass-through. If complexity reappears across N callers, it was earning its keep.
- **The interface is the test surface.**
- **One adapter = hypothetical seam. Two adapters = real seam.**

## 可操作流程

### 1. Explore

Read the project's domain glossary (`CONTEXT.md`) and any ADRs in the area you're touching first.

Then explore the codebase organically and note where you experience friction:

- Where does understanding one concept require bouncing between many small modules?
- Where are modules **shallow** — interface nearly as complex as the implementation?
- Where have pure functions been extracted just for testability, but the real bugs hide in how they're called (no **locality**)?
- Where do tightly-coupled modules leak across their seams?
- Which parts of the codebase are untested, or hard to test through their current interface?

Apply the **deletion test** to anything you suspect is shallow.

### 2. Present candidates

Present a numbered list of deepening opportunities. For each candidate:

- **Files** — which files/modules are involved
- **Problem** — why the current architecture is causing friction
- **Solution** — plain English description of what would change
- **Benefits** — explained in terms of locality and leverage, and also in how tests would improve
- **Dependencies** — classify into [references/DEEPENING.md](references/DEEPENING.md) categories so the testing strategy is clear

**Use CONTEXT.md vocabulary for the domain.** If `CONTEXT.md` defines "Order," talk about "the Order intake module" — not "the FooBarHandler."

**ADR conflicts**: if a candidate contradicts an existing ADR, only surface it when the friction is real enough to warrant revisiting the ADR.

Do NOT propose interfaces yet. Ask the user: "Which of these would you like to explore?"

### 3. Grilling loop

Once the user picks a candidate, drop into a grilling conversation. Walk the design tree with them — constraints, dependencies, the shape of the deepened module, what sits behind the seam, what tests survive.

Side effects happen inline:
- **Naming a deepened module after a concept not in CONTEXT.md?** Add the term to `CONTEXT.md`.
- **Sharpening a fuzzy term?** Update `CONTEXT.md` right there.
- **User rejects the candidate with a load-bearing reason?** Offer an ADR so future architecture reviews don't re-suggest it.

### 4. Interface design (optional)

If the user wants to explore alternative interfaces for the chosen candidate, load [references/INTERFACE-DESIGN.md](references/INTERFACE-DESIGN.md) and run the parallel sub-agent pattern.

### gxpm 集成

- Run `/architecture` once every few days, or after `/diagnose` surfaces an architectural root cause.
- During `self-review`, apply the deletion test to new modules introduced in the PR.
- After `land`, if architecture recommendations were deferred, create a follow-up issue via `gxpm issue create --auto-id`.

## Red Flags（红旗清单 / 反模式）

Do NOT use architecture deepening when:

- The user wants a purely cosmetic rename. Use `gxpm-refactor-safely` instead.
- The code is already deep, well-tested, and stable. If the deletion test shows the module earns its keep, leave it alone.
- The change is urgent and tactical (hotfix, security patch). Architecture work is strategic; defer it.
- You have not read `CONTEXT.md` and the relevant ADRs. Surfacing friction without domain vocabulary produces shallow advice.

**Counter-examples:** Proposing full seam extraction for a simple rename is wrong — architecture skill is for structural depth, not naming preferences. Suggesting to split a module that passes the deletion test because it "looks large" is wrong — size is not depth.

## Verification（验证清单 / 出口条件）

- [ ] 已阅读 `CONTEXT.md` 和相关 ADR
- [ ] 已用删除测试（deletion test）排查候选模块
- [ ] deepening opportunities 已按 Files / Problem / Solution / Benefits / Dependencies 结构化呈现
- [ ] 用户使用 `CONTEXT.md` 术语确认候选方案
- [ ] 如需接口设计，已运行并行 sub-agent 模式并给出有主见的推荐
- [ ] 如需更新 `CONTEXT.md` 或新增 ADR，已 inline 完成

## Read Next

- `/gxpm-grill` — stress-test design
- `/gxpm-refactor-safely` — apply changes with impact analysis
- `CONTEXT.md`
- `docs/adr/`
