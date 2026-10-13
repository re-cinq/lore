# Implementation Plan: Shared organisation skills

| Feature | Shared organisation skills  |
| ------- | --------------------------- |
| Branch  | org-skills                  |
| Spec    | [spec.md](./spec.md)        |
| Created | 2026-10-13                  |

This feature introduces a dynamic, database-backed system for managing organisation skills via the Lore web UI. These skills are automatically distributed and updated on local developers' machines by the local MCP server, replacing the static files in the repository.

## Mechanisms

### Data model

- `lore.skill_definitions` table.

### Trigger wiring

- Local MCP server sync mechanism to install and update skills on developers' machines.
- Web UI and REST API for CRUD operations on skill definitions.
