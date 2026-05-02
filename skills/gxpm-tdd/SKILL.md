---
name: tdd
description: Test-driven development with red-green-refactor loop via vertical slices. Use when user wants to build features or fix bugs using TDD, mentions 'red-green-refactor', wants integration tests, or asks for test-first development.
---

# Test-Driven Development

## Philosophy

**Core principle**: Tests should verify behavior through public interfaces, not implementation details. Code can change entirely; tests shouldn't.

**Good tests** are integration-style: they exercise real code paths through public APIs. They describe _what_ the system does, not _how_ it does it.

**Bad tests** are coupled to implementation. They mock internal collaborators, test private methods, or verify through external means. The warning sign: your test breaks when you refactor, but behavior hasn't changed.

## Anti-Pattern: Horizontal Slices

**DO NOT write all tests first, then all implementation.** This is "horizontal slicing" — treating RED as "write all tests" and GREEN as "write all code."

This produces **crap tests**:
- Tests written in bulk test _imagined_ behavior, not _actual_ behavior
- You end up testing the _shape_ of things rather than user-facing behavior
- Tests become insensitive to real changes

**Correct approach**: Vertical slices via tracer bullets.

```
WRONG (horizontal):
  RED:   test1, test2, test3, test4, test5
  GREEN: impl1, impl2, impl3, impl4, impl5

RIGHT (vertical):
  RED→GREEN: test1→impl1
  RED→GREEN: test2→impl2
  RED→GREEN: test3→impl3
  ...
```

## Workflow

### 1. Planning

Before writing any code:
- [ ] Confirm with user what interface changes are needed
- [ ] Confirm which behaviors to test (prioritise)
- [ ] Identify opportunities for deep modules (small interface, deep implementation)
- [ ] Design interfaces for testability
- [ ] List the behaviors to test (not implementation steps)
- [ ] Get user approval on the plan

**You can't test everything.** Focus on critical paths and complex logic.

### 2. Tracer Bullet

Write ONE test that confirms ONE thing about the system:

```
RED:   Write test for first behavior → test fails
GREEN: Write minimal code to pass → test passes
```

This is your tracer bullet — proves the path works end-to-end.

### 3. Incremental Loop

For each remaining behavior:

```
RED:   Write next test → fails
GREEN: Minimal code to pass → passes
```

Rules:
- One test at a time
- Only enough code to pass current test
- Don't anticipate future tests
- Keep tests focused on observable behavior

### 4. Refactor

After all tests pass, look for refactor candidates:
- [ ] Extract duplication
- [ ] Deepen modules (move complexity behind simple interfaces)
- [ ] Apply SOLID principles where natural
- [ ] Run tests after each refactor step

**Never refactor while RED.** Get to GREEN first.

## Checklist Per Cycle

```
[ ] Test describes behavior, not implementation
[ ] Test uses public interface only
[ ] Test would survive internal refactor
[ ] Code is minimal for this test
[ ] No speculative features added
```

## gxpm integration

- During `implement`, treat the first sub-task as the **tracer bullet**.
- Use `gxpm run event <issue-id> <run-id> --type test-passed` to record test milestones.
- Before leaving `implement`, the `local-verify` artifact should list all vertical slices completed.
- If a bug is found during TDD, switch to `/diagnose` skill before fixing.
