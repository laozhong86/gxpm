# Feedback Loop Construction Catalog

Reference for Phase 1 of `/gxpm-diagnose`. Try these in roughly this order.

## 1. Failing test
At whatever seam reaches the bug — unit, integration, e2e.

## 2. Curl / HTTP script
Against a running dev server.

## 3. CLI invocation
With a fixture input, diffing stdout against a known-good snapshot.

## 4. Headless browser script
Playwright / Puppeteer — drives the UI, asserts on DOM/console/network.

## 5. Replay a captured trace
Save a real network request / payload / event log to disk; replay it through the code path in isolation.

## 6. Throwaway harness
Spin up a minimal subset of the system (one service, mocked deps) that exercises the bug code path with a single function call.

## 7. Property / fuzz loop
If the bug is "sometimes wrong output", run 1000 random inputs and look for the failure mode.

## 8. Bisection harness
If the bug appeared between two known states (commit, dataset, version), automate "boot at state X, check, repeat" so you can `git bisect run` it.

## 9. Differential loop
Run the same input through old-version vs new-version (or two configs) and diff outputs.

## 10. HITL bash script
Last resort. If a human must click, drive _them_ with a structured loop so the feedback is still structured. Captured output feeds back to you.

---

## Loop quality checklist

Once you have _a_ loop, iterate:

- [ ] **Faster** — Cache setup, skip unrelated init, narrow the test scope.
- [ ] **Sharper** — Assert on the specific symptom, not "didn't crash".
- [ ] **More deterministic** — Pin time, seed RNG, isolate filesystem, freeze network.
