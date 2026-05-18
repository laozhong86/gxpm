# Mocking Guidelines

Reference for `/gxpm-tdd`. Read this before adding mocks, changing tests, or adding test-only methods to production code.

## Prefer real collaborators

Mock only at system boundaries (HTTP, database, file system, clock). Everything inside the application boundary should use real objects.

## Mocking red flags

- You need to mock more than 2 collaborators for a single test → design is too coupled.
- The mock verifies it was called with specific arguments → test is coupled to implementation, not behavior.
- You need a "test-only" method on production code → the seam is in the wrong place.

## Good seams for mocking

| Boundary | Mock strategy |
|----------|--------------|
| HTTP client | Stub the transport layer, not the service calling it |
| Database | In-memory test DB or transaction rollback |
| File system | Temp directory with cleanup |
| Clock | Injectable `now()` function or frozen time |
| Random | Injectable seed |

## One adapter = hypothetical seam. Two adapters = real seam.

If you have one production adapter and one test adapter, the seam is real and worth keeping. If you only have a test adapter, reconsider whether the abstraction pulls its weight.
