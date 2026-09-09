// The lore.agent_definitions statements PgAgentDefs runs, kept out of the adapter so the SQL text does not crowd the functions that bind it.

// Qualified with `a` alias: resolve/list queries LEFT JOIN lore.repos (unqualified selects would be ambiguous).
const JOIN_COLS =
  "a.name, a.model, a.timeout_minutes, a.prompt, a.image, a.execution_mode, a.review_required, a.project_id, a.config";

// Unqualified for INSERT ... RETURNING (single table, no alias in scope).
export const RET_COLS =
  "name, model, timeout_minutes, prompt, image, execution_mode, review_required, project_id, config";

// Merged config for upsert — pod_resources edit applied under row lock to prevent concurrent edits being discarded.
function mergedConfigSql(
  own: string,
  touched: number,
  inherited: number,
  block: number,
): string {
  return `CASE WHEN $${touched}::boolean
    THEN NULLIF(
      (COALESCE(${own}, $${inherited}::jsonb, '{}'::jsonb) - 'pod_resources')
        || COALESCE($${block}::jsonb, '{}'::jsonb),
      '{}'::jsonb)
    ELSE ${own} END`;
}

export const RESOLVE_DEF_SQL = `SELECT ${JOIN_COLS} FROM lore.agent_definitions a
         LEFT JOIN lore.repos r ON r.id = a.project_id
        WHERE a.name = $1 AND (a.project_id IS NULL OR r.full_name = $2)`;

export const LIST_DEFS_SQL = `SELECT ${JOIN_COLS} FROM lore.agent_definitions a
         LEFT JOIN lore.repos r ON r.id = a.project_id
        WHERE a.project_id IS NULL OR r.full_name = $1`;

export const CATALOG_ENTRY_SQL = `SELECT ${JOIN_COLS} FROM lore.agent_definitions a
      WHERE a.name = $1 AND (a.project_id IS NULL OR a.project_id = $2)`;

/** Override earns qualified name only if cluster applied its CR; prevents dispatch at unresolvable stationRef (2026-09-01 outage). */
export const QUALIFIED_STATION_SQL = `SELECT a.project_id FROM lore.agent_definitions a
       JOIN lore.repos r ON r.id = a.project_id
      WHERE a.name = $1 AND r.full_name = $2
        AND NOT (
          EXISTS (
            SELECT 1 FROM lore.catalog_apply_status s
             WHERE s.name = a.name AND s.project_id = a.project_id
               AND s.state = 'refused'
          )
          AND NOT EXISTS (
            SELECT 1 FROM lore.catalog_apply_status s
             WHERE s.name = a.name AND s.project_id = a.project_id
               AND s.state = 'applied'
          )
        )`;

/** Upserts the ORG-DEFAULT row (project_id IS NULL); the catalog event rides along so cluster-agents see the change. */
export const UPDATE_ORG_DEF_SQL = `WITH written AS (
       INSERT INTO lore.agent_definitions
         (name, model, timeout_minutes, prompt, image, execution_mode, review_required, config, project_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, ${mergedConfigSql("$8::jsonb", 9, 10, 11)}, NULL)
       ON CONFLICT (name) WHERE project_id IS NULL DO UPDATE SET
         model = EXCLUDED.model,
         timeout_minutes = EXCLUDED.timeout_minutes,
         prompt = EXCLUDED.prompt,
         image = EXCLUDED.image,
         execution_mode = EXCLUDED.execution_mode,
         review_required = EXCLUDED.review_required,
         config = ${mergedConfigSql("lore.agent_definitions.config", 9, 10, 11)},
         updated_at = now()
       RETURNING ${RET_COLS}
     ), event AS (
       INSERT INTO lore.catalog_events (name, project_id, op)
       SELECT name, project_id, 'upsert' FROM written
     )
     SELECT ${RET_COLS} FROM written`;

/** Written CTE row and catalog_events append land in ONE statement — a definition cannot exist without its change event. */
export const CREATE_DEF_SQL = `WITH written AS (
         INSERT INTO lore.agent_definitions
           (name, model, timeout_minutes, prompt, image, execution_mode, review_required, config, project_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, (SELECT id FROM lore.repos WHERE full_name = $9))
         RETURNING ${RET_COLS}
       ), event AS (
         INSERT INTO lore.catalog_events (name, project_id, op)
         SELECT name, project_id, 'upsert' FROM written
       )
       SELECT ${RET_COLS} FROM written`;

/** Upserts the PROJECT row, so editing an inherited org default forks a row rather than rewriting the default for every other repo. The catalog event goes in the same statement: a definition change nothing observed is a change the running fleet never picks up. */
export const UPDATE_DEF_SQL = `WITH written AS (
         INSERT INTO lore.agent_definitions
           (name, model, timeout_minutes, prompt, image, execution_mode, review_required, config, project_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, ${mergedConfigSql("$8::jsonb", 10, 11, 12)}, (SELECT id FROM lore.repos WHERE full_name = $9))
         ON CONFLICT (name, project_id) WHERE project_id IS NOT NULL DO UPDATE SET
           model = EXCLUDED.model,
           timeout_minutes = EXCLUDED.timeout_minutes,
           prompt = EXCLUDED.prompt,
           image = EXCLUDED.image,
           execution_mode = EXCLUDED.execution_mode,
           review_required = EXCLUDED.review_required,
           config = ${mergedConfigSql("lore.agent_definitions.config", 10, 11, 12)},
           updated_at = now()
         RETURNING ${RET_COLS}
       ), event AS (
         INSERT INTO lore.catalog_events (name, project_id, op)
         SELECT name, project_id, 'upsert' FROM written
       )
       SELECT ${RET_COLS} FROM written`;

export const DELETE_DEF_SQL = `WITH removed AS (
         DELETE FROM lore.agent_definitions
          WHERE name = $1
            AND project_id = (SELECT id FROM lore.repos WHERE full_name = $2)
         RETURNING name, project_id
       )
       INSERT INTO lore.catalog_events (name, project_id, op)
       SELECT name, project_id, 'delete' FROM removed`;
