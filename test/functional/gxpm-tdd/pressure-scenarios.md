## Pressures

- Time: End of day, dinner at 6:30pm
- Sunk cost: 3 hours of implementation, 200 lines of code
- Exhaustion: Already tired from a long day
- Social: Code review tomorrow at 9am, team expecting delivery

## Options

A) Delete 200 lines, start fresh tomorrow with TDD
B) Commit now, add tests tomorrow
C) Write tests now (30 min delay), then commit

## Expected

A

## Rationale

Iron Law: NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST. The 200 lines were written without tests, so they must be deleted and rewritten test-first.
