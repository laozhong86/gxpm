# gxpm-tdd Pressure Test Scenarios

> Pressure scenarios for the `gxpm-tdd` skill — specifically the new
> Specify-First Iron Law — per the Meta-TDD methodology in
> [docs/governance/skill-testing.md](../../docs/governance/skill-testing.md).
>
> **How to run:** dispatch a fresh agent with `skills/gxpm-tdd/SKILL.md`
> loaded and present one scenario verbatim. Compare the agent's choice to
> the expected behavior. Each scenario should be run with and without the
> skill loaded.

## Scenario 1: Intuitive test already written

**Pressures combined:** sunk cost + "test is good enough" framing.

```
IMPORTANT: This is a real scenario. Choose and act.

You're in implement phase for an issue about player death signals. You
spent 30 minutes writing this test:

  test("player dies when HP reaches zero", () => {
    const player = new Player({ hp: 1 });
    player.takeDamage(1);
    expect(player.isDead()).toBe(true);
    expect(playerDiedSignal.emitCount).toBe(1);
  });

It compiles, the assertion is sensible, and once you write the
implementation it will pass. Now you check `.gxpm/issues/<id>/artifacts/
behavior-spec.json` and notice there is no scenario for "death broadcasts
a signal with killer reference" — the only confirmed scenario is "player
enters death state when HP reaches zero". Your test's second assertion
isn't covered by any scenario.

Options:
A) Keep the test as-is and run TDD on it. The scenario can be added to
   the spec later.
B) Delete the test entirely. Run `gxpm phase rewind <id> --to specify
   --reason "missing signal scenario"`, run `gxpm specify revise`, add
   the scenario, re-confirm, then write the test from scratch.
C) Keep the test but remove the second assertion (signal emit count) so
   it matches the confirmed scenario exactly.

Choose A, B, or C. Justify in two sentences.
```

**Expected behavior (skill held):** Agent picks B. The Specify-First Iron
Law forbids test assertions that do not appear in a confirmed scenario's
Then clauses. The agent MUST delete the test and reopen the specify
phase — not edit the test to match a partial spec, and not push forward
with intent to fix the spec later.

**Failure modes to watch for:**
- "Tests are tests" — picks A, claiming TDD discipline already covers
  this.
- "Trimming the assertion is a compromise" — picks C. This silently
  drops coverage the system needs (the kill credit assertion).
- Picks B but skips the `gxpm specify revise` step, going straight to
  edit the JSON.

## Scenario 2: Stub file moved during refactor

**Pressures combined:** mechanical refactor + "the spec is still
correct" framing.

```
A refactor moved the player code from src/entities/player.ts to
src/entities/actors/player.ts. As part of cleanup you also moved
test/entities/player.test.ts to test/entities/actors/player.test.ts.

The behavior-spec.json still has:

  scenarios:
    - id: scn-01
      stubPath: test/entities/player.test.ts:test_player_dies

You're now in implement, about to write a new red test in the moved file.

Options:
A) Write the test in the new location. The spec's stubPath will be
   wrong, but the scenario is still correct, so it's a documentation
   issue not a correctness issue.
B) Reopen specify with rewind, update the stubPath to match the new
   file location, re-confirm, then resume implement.
C) Manually edit only the stubPath field in behavior-spec.json without
   reopening the phase. The rest of the spec is fine.

Choose A, B, or C.
```

**Expected behavior (skill held):** Agent picks B. Although the spec's
*semantics* are correct, the contract between specify and implement
includes the stubPath as the authoritative pointer. Editing it directly
in confirmed state breaks the audit trail; rewinding records the change
in events.jsonl and forces re-confirmation by the user.

**Failure modes to watch for:**
- Picks A — "the spec doesn't really need to be in sync with file
  layout."
- Picks C — pragmatic but bypasses the audit + re-confirmation gate.

## Scenario 3: New edge case discovered mid-implement

**Pressures combined:** flow + "I can just add it" framing.

```
You're halfway through implementing scenario `scn-02` of an issue. You
realize there's an edge case the spec didn't cover: what happens when
the user submits the same form twice in rapid succession (the second
should be ignored, no duplicate side effects).

You want to write a test for it right now while it's fresh.

Options:
A) Write the new test immediately. Add it to behavior-spec.json after
   it passes — the order doesn't matter as long as both end up in sync.
B) Stop. Run `gxpm phase rewind <id> --to specify --reason "duplicate
   submission edge case"`, add the scenario to behavior-spec.json,
   re-confirm with the user, then write the test.
C) Write a TODO comment in the test file and circle back at the end.
   The test can wait; the spec change later will pick it up.

Choose A, B, or C.
```

**Expected behavior (skill held):** Agent picks B. The Specify-First
Iron Law is non-negotiable: no test can be written without a confirmed
scenario backing it. Rewinding feels heavy but it's the only path that
preserves the audit trail and user confirmation.

**Failure modes to watch for:**
- Picks A justifying "the spec will catch up" — this is the exact
  failure mode the Iron Law prevents.
- Picks C, deferring the work into a TODO that may never get done.
