# Preset System Architecture

> Override > Preset > Core three-layer resolution for gxpm templates and skills.

## Overview

The preset system allows projects to customize gxpm-generated artifacts (skills, templates, commands) without forking the core repository. It implements a subset of Spec Kit's four-layer extensibility stack:

| Layer | Path | Priority | Purpose |
|-------|------|----------|---------|
| Override | `.gxpm/overrides/` | Highest | One-off local adjustments (full replacement) |
| Preset | `.gxpm/presets/<id>/` | Middle | Shareable, stackable template/command overrides |
| Core | `skills/`, `templates/` | Lowest | Built-in defaults |

Extension and hooks are deferred to future iterations (MVP: Override + Preset + Core only).

## Directory Layout

```
.gxpm/
├── overrides/              # Override layer (mirrors project root structure)
│   └── skills/
│       └── gxpm/
│           └── SKILL.md    # Full replacement of generated skill
├── presets/
│   ├── .registry           # Active preset IDs (JSON)
│   ├── default/
│   │   ├── manifest.json   # Preset manifest
│   │   └── skill.md        # Source file for replace rule
│   └── team-alpha/
│       ├── manifest.json
│       └── header.md
```

## Registry Format

`.gxpm/presets/.registry`:

```json
{
  "active": ["team-alpha", "default"]
}
```

- `active` is ordered by priority (first = highest).
- Presets not in `active` are loaded but not applied.

## Manifest Schema

`manifest.json`:

```json
{
  "id": "default",
  "name": "Default Preset",
  "version": "1.0.0",
  "description": "Optional description",
  "extends": ["base-preset"],
  "rules": [
    {
      "target": "skills/gxpm/SKILL.md",
      "strategy": "replace",
      "source": "skill.md"
    },
    {
      "target": "skills/*/SKILL.md",
      "strategy": "append",
      "source": "notice.md"
    }
  ]
}
```

### Fields

- `id` — unique preset identifier (matches directory name)
- `name` — human-readable name
- `version` — semver string
- `description` — optional description
- `extends` — IDs of lower-priority presets to inherit (not yet implemented in MVP)
- `rules` — composition rules

### Rule Fields

- `target` — file path relative to project root; supports `*` wildcard
- `strategy` — `replace` | `prepend` | `append` | `wrap`
- `source` — file path relative to preset directory
- `anchor` — optional marker for positioning (prepend/append/wrap)

## Composition Strategies

| Strategy | Behavior |
|----------|----------|
| `replace` | Full replacement with source content |
| `prepend` | Insert source before target (or before `anchor`) |
| `append` | Insert source after target (or after `anchor`) |
| `wrap` | Wrap target with source (or replace `anchor` with source) |

## Integration with gen:skill-docs

`scripts/gen-skill-docs.ts` integrates `PresetResolver` after template rendering:

1. Render `.tmpl` → base content
2. Call `PresetResolver.resolve(outputPath, baseContent)`
3. Write resolved content to disk

This means presets can override:
- Template variables (by replacing the entire generated file)
- Specific sections (by append/prepend/wrap with anchors)
- Static skills (by targeting their output path)

## CLI Commands

```bash
gxpm preset list              # List all presets and active status
gxpm preset add <id>          # Activate a preset
gxpm preset remove <id>       # Deactivate a preset
gxpm preset show <id>         # Show preset manifest and rules
gxpm preset init <id>         # Create a new preset directory
```

## Backward Compatibility

- No `.gxpm/presets/` directory → `PresetResolver` returns core content unchanged
- No `.gxpm/overrides/` directory → override layer is skipped
- Existing `gen:skill-docs` behavior is preserved when no presets are active
