# TDD Troubleshooting

Reference for `/gxpm-tdd`.

## Don't know how to test

Write the wished-for API first. Write the assertion first. If still stuck, ask your human partner — the interface design is unclear.

## Test too complicated

Design is too complicated. Simplify the interface. A hard-to-test module is hard to use.

## Must mock everything

Code is too coupled. Use dependency injection. Move integration points to the edges.

## Test setup is huge

Extract helpers. If still complex after helpers, simplify the design — the module has too many dependencies.

## Test passes immediately

This usually means:
- The test doesn't actually assert anything meaningful.
- The implementation was written before the test (violation of Iron Law).
- The test is asserting on the wrong thing.

**Action:** Stop. Verify the test can fail by deliberately breaking the assertion. If it still passes, delete and rewrite.
