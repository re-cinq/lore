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

/** Upserts the ORG-DEFAULT row (project_id IS NULL). */
export const UPDATE_ORG_DEF_SQL = `INSERT INTO lore.agent_definitions
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
       RETURNING ${RET_COLS}`;

export const CREATE_DEF_SQL = `INSERT INTO lore.agent_definitions
         (name, model, timeout_minutes, prompt, image, execution_mode, review_required, config, project_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, (SELECT id FROM lore.repos WHERE full_name = $9))
       RETURNING ${RET_COLS}`;

/** Upserts the PROJECT row, so editing an inherited org default forks a row rather than rewriting the default for every other repo. */
export const UPDATE_DEF_SQL = `INSERT INTO lore.agent_definitions
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
       RETURNING ${RET_COLS}`;

export const DELETE_DEF_SQL = `DELETE FROM lore.agent_definitions
        WHERE name = $1
          AND project_id = (SELECT id FROM lore.repos WHERE full_name = $2)`;

// Boot seeding of the shipped defaults (specs/lore-agents FR27). One advisory lock serializes every replica's boot.
export const SEED_LOCK_SQL = `SELECT pg_advisory_xact_lock(hashtext('lore.agent-defaults-seed'))`;

export const SEED_ROWS_SQL = `SELECT name, model, timeout_minutes, prompt, execution_mode, review_required, config, shipped_default
         FROM lore.agent_definitions
        WHERE project_id IS NULL AND name = ANY($1::text[])
          FOR UPDATE`;

export const SEED_INSERT_SQL = `INSERT INTO lore.agent_definitions
         (name, model, timeout_minutes, prompt, execution_mode, review_required, config, shipped_default, project_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, NULL)
       RETURNING name`;

export const SEED_UPDATE_SQL = `UPDATE lore.agent_definitions
          SET model = $2, timeout_minutes = $3, prompt = $4, execution_mode = $5,
              review_required = $6, config = $7::jsonb, shipped_default = $8::jsonb,
              updated_at = now()
        WHERE name = $1 AND project_id IS NULL
        RETURNING name`;

export const SEED_REMEMBER_SQL = `UPDATE lore.agent_definitions SET shipped_default = $2::jsonb
        WHERE name = $1 AND project_id IS NULL`;
