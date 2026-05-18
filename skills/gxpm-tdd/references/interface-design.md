# Interface Design for Testability

Reference for `/gxpm-tdd`.

## Deep modules

A deep module encapsulates a lot of functionality in a simple, testable interface which rarely changes. Aim for small interface, deep implementation.

> "The best modules are deep. They allow a lot of functionality to be accessed through a simple interface."
> — John Ousterhout, A Philosophy Of Software Design

## Testability checklist

- [ ] Can I test this through its public interface only?
- [ ] Would this test survive a complete internal rewrite?
- [ ] Is the interface smaller than the implementation?
- [ ] Are error modes explicit and testable?

## Warning signs

- Constructor takes 5+ dependencies → module is doing too much.
- Test needs to know internal state → interface is incomplete.
- Renaming a private function breaks tests → tests are coupled to implementation.
