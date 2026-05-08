---
name: diagnose
description: Disciplined diagnosis loop for hard bugs and performance regressions. Use when user says 'diagnose this', reports a hard bug, describes a performance regression, or asks why something fails.
---
<!-- AUTO-GENERATED from SKILL.md.tmpl - do not edit directly -->

# Diagnose

A discipline for hard bugs. Skip phases only when explicitly justified.

## Phase 1 — Build a feedback loop

**This is the skill.** Everything else is mechanical. If you have a fast, deterministic, agent-runnable pass/fail signal for the bug, you will find the cause.

Spend disproportionate effort here. **Be aggressive. Be creative. Refuse to give up.**

### Ways to construct one — try in roughly this order

1. **Failing test** at whatever seam reaches the bug — unit, integration, e2e.
2. **Curl / HTTP script** against a running dev server.
3. **CLI invocation** with a fixture input, diffing stdout against a known-good snapshot.
4. **Headless browser script** (Playwright / Puppeteer).
5. **Replay a captured trace.** Save a real network request / payload / event log to disk; replay it through the code path in isolation.
6. **Throwaway harness.** Spin up a minimal subset of the system that exercises the bug code path.
7. **Property / fuzz loop.** Run 1000 random inputs and look for the failure mode.
8. **Bisection harness.** Automate `git bisect run` if the bug appeared between two known states.
9. **Differential loop.** Run old-version vs new-version and diff outputs.
10. **HITL bash script.** Last resort. If a human must click, drive them with a structured loop.

### Iterate on the loop itself

- Can I make it faster? (Cache setup, skip unrelated init.)
- Can I make the signal sharper? (Assert on the specific symptom.)
- Can I make it more deterministic? (Pin time, seed RNG, isolate filesystem.)

### Non-deterministic bugs

The goal is a **higher reproduction rate**. Loop the trigger 100×, parallelise, add stress. A 50%-flake bug is debuggable; 1% is not.

### When you genuinely cannot build a loop

Stop and say so explicitly. List what you tried. Ask the user for: (a) access to the repro environment, (b) a captured artifact, or (c) permission to add temporary production instrumentation.

**Do not proceed to Phase 2 until you have a loop you believe in.**


## Phase 2 — Reproduce

Run the loop. Confirm:
- [ ] The loop produces the failure mode the **user** described.
- [ ] The failure is reproducible across multiple runs.
- [ ] You have captured the exact symptom.

## Phase 3 — Explore with the codebase

Use available code intelligence tools (e.g., GitNexus MCP, grep, ReadFile) to accelerate understanding:

1. **Semantic search** to find code related to the symptom.
2. **Call-chain tracing** to follow `callers_of` / `callees_of` relationships.
3. **Execution flow analysis** to see full paths through suspected areas.
4. **Change detection** (`git diff`, `detect_changes`) to check if recent changes caused the issue.
5. **Impact analysis** on suspected files to see what else is affected.

**Token efficiency**: start with the narrowest context possible, then expand. Target ≤5 tool calls and ≤800 total output tokens for the exploration phase.

## Phase 4 — Hypothesise

Generate **3–5 ranked hypotheses** before testing any of them.

Each hypothesis must be **falsifiable**: state the prediction it makes.

> Format: "If <X> is the cause, then <changing Y> will make the bug disappear."

**Show the ranked list to the user before testing.** They often have domain knowledge that re-ranks instantly.

## Phase 5 — Instrument

Each probe must map to a specific prediction from Phase 4. **Change one variable at a time.**

Tool preference:
1. **Debugger / REPL inspection** if the env supports it.
2. **Targeted logs** at the boundaries that distinguish hypotheses.
3. Never "log everything and grep".

**Tag every debug log** with a unique prefix, e.g. `[DEBUG-a4f2]`. Cleanup at the end becomes a single grep.

**Perf branch.** For performance regressions: establish a baseline measurement first, then bisect. Measure first, fix second.

## Phase 6 — Fix + regression test

Write the regression test **before the fix** — but only if there is a **correct seam** for it.

A correct seam is one where the test exercises the **real bug pattern** as it occurs at the call site.

**If no correct seam exists, that itself is the finding.** Flag this for the next `/architecture` run.

## Phase 7 — Cleanup + post-mortem

Required before declaring done:
- [ ] Original repro no longer reproduces.
- [ ] Regression test passes (or absence of seam is documented).
- [ ] All `[DEBUG-...]` instrumentation removed.
- [ ] Throwaway prototypes deleted.
- [ ] The correct hypothesis is stated in the commit / PR message.

**Then ask: what would have prevented this bug?** If the answer involves architectural change, hand off to `/architecture` with the specifics.

