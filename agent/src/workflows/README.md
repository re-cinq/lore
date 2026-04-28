# Workflow definitions

YAML graph definitions for dark-factory workflows. Loaded at supervisor startup
and at local-runner spawn (FR2.3 — same definition file, both runtimes).

## Conventions

- One file per task type: `agent/src/workflows/<task_type>.yaml`.
- Schema documented in `specs/6-dark-factory/contracts/workflow-yaml-schema.md`.
- Validation: Zod schema in `agent/src/workflow/loader.ts` (T012). Loader is
  fail-fast — malformed YAML or schema violation prevents supervisor startup.
- Cycles MUST carry `iteration_max` on the back-edge; otherwise the loader
  refuses to load the graph.
- Per-repo overrides go in `lore.repos.settings.workflows[]` and are validated
  against the same schema.

## Status

Empty until T013 (gap-fill), T030 (general), T031 (implementation). Other
flows (runbook, review, feature-request, onboard) migrate in Phase 2 Task 2.3.
