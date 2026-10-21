# Definition of Done

> The domain model for lore.skill_definitions MUST be defined as a Zod schema with ColumnMap + fromRow/selectList helpers, following existing models like agent-definition. The skill payload maps directly to the schema expected by Claude Code.

**Strategy: `direct`** — The file and module for the new domain model do not exist yet, so we write an acceptance test that attempts to use the non-existent schema and fails by `ERR_MODULE_NOT_FOUND` as the behavior is absent.

## Done when these pass

- [ ] **validates and deserializes skill definition rows** — verify serialization/deserialization for skill definitions using the new Zod schema and ColumnMap
  `libs/shared/src/domain/models/skill-definition.acceptance.test.ts`

## Facets

- [x] Create `libs/shared/src/domain/models/skill-definition.ts`
- [x] Define Zod schema mapping to DB columns (name, title, description, model, content, enabled, project_id)
- [x] Define `SKILL_DEFINITION_COLUMNS` ColumnMap

## Out of scope

- CRUD REST API for skill definitions
- Implementing the web UI for skills
