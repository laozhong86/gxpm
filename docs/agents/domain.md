# Domain Docs Layout

> Defines where domain documentation lives and how skills consume it.

## Layout

This repo uses a **single-context** layout:

```
/
├── CONTEXT.md              # shared language / glossary
├── docs/adr/               # architecture decision records
│   ├── 0001-example-decision.md
│   └── ...
└── skills/                 # agent skills
    └── ...
```

## Consumer Rules

- `/grill` reads and writes `CONTEXT.md` during alignment sessions.
- `/architecture` reads `CONTEXT.md` for domain vocabulary and `docs/adr/` for past decisions.
- `/diagnose` and `/tdd` read `CONTEXT.md` to name tests and interfaces consistently.
- Skills must not read implementation details into `CONTEXT.md` — only terms meaningful to domain experts.

## Creating docs lazily

- Create `CONTEXT.md` when the first domain term is resolved.
- Create `docs/adr/` when the first ADR is needed.
- Do not create empty scaffolding.
