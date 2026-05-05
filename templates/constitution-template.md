# gxpm Specification-Driven Development Constitution

> Adapted from Spec Kit's Nine Articles of Development.
> These constraints are enforced as Phase -1 Gates before plan phase advancement.

## Nine Articles

### 1. Capability-First
Every feature must first exist as a capability contract in `core/capabilities.ts` before implementation.
- Declare input/output, mutation scope, idempotency, failure modes, and evidence metadata.
- No code without a declared capability slice.

### 2. CLI Interface Mandate
All capabilities must expose a CLI surface (stdin/stdout, JSON-compatible).
- Commands are the primary integration point, not internal APIs.
- `gxpm capability list/show` remains read-only; execution is a separate concern.

### 3. Test-First Imperative
Strict red-green-refactor for all non-trivial changes.
- Write the test before the implementation.
- `bun test` is the fast gate; it must pass before any phase transition.

### 4. Composition over Inheritance
Prefer composing small, focused modules over deep inheritance hierarchies.
- `StepBase`, `HostAdapter`, and `PresetResolver` are interfaces, not base classes.
- Mixins and inheritance are last resorts.

### 5. Explicit over Implicit
No magic, no hidden conventions, no global state mutations.
- All side effects must be declared in capability contracts.
- Configuration is explicit: `config.json` > env > default.

### 6. Fail Fast, Fail Loud
Errors must surface immediately with actionable context.
- No silent swallowing of exceptions.
- Validation happens at the boundary (config, artifact, command input).

### 7. Simplicity Gate
A feature must justify its complexity. When in doubt, delete.
- Max 3 modules per feature slice unless proven otherwise.
- Preset system MVP: Override + Preset + Core only; Extension and hooks deferred.

### 8. Anti-Abstraction
Use framework/language features directly. Avoid wrapper upon wrapper.
- `yaml` library directly, not a custom YAML parser.
- `execSync` directly, not a "command runner abstraction layer".

### 9. Integration-First Testing
Prefer real environments over mocks for integration surfaces.
- Browser tests use real Playwright, not stubbed.
- Linear integration tests hit real API in sandbox mode.
- Unit tests mock; integration tests verify.

## Phase -1 Gates

Before advancing from `triage` to `plan`, confirm:

- [ ] **Capability declared?** — `core/capabilities.ts` has the slice.
- [ ] **Test strategy defined?** — Implementation plan includes test approach.
- [ ] **Simplicity justified?** — Feature complexity is minimal viable.
- [ ] **Integration path clear?** — Real environment testing is planned, not deferred indefinitely.

These gates are optional for spike/investigation issues (type=spike), mandatory for feature delivery (default type).
