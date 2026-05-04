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
