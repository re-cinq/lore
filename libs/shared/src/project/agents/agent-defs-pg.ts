import type { PgPool } from "../../memory-store.js";
import { catalogCrdName } from "./agent-crd.js";
import {
  resolveAgentConfig,
  type AgentDefinition,
  type AgentDefinitionInput,
  type AgentDefsPort,
} from "./agent-defs-port.js";

/**
 * AgentDefsPort over lore.agent_definitions. resolve/list field-merge three layers via the
 * pure resolveAgentConfig: the repo's project row → the org default row → the
 * task-types.yaml `base` (so org rows seed only the tunable scalars and leave
 * prompt to inherit the yaml). Writes target the repo's project row. The pod
 * never reaches this adapter — it uses AgentDefsHttp.
 */

// Qualified with the `a` alias: the resolve/list queries LEFT JOIN lore.repos,
// which also has `name`/`id` columns, so unqualified selects are ambiguous.
const JOIN_COLS =
  "a.name, a.model, a.timeout_minutes, a.prompt, a.image, a.execution_mode, a.review_required, a.project_id, a.config";
// Unqualified for INSERT ... RETURNING (single table, no alias in scope).
const RET_COLS =
  "name, model, timeout_minutes, prompt, image, execution_mode, review_required, project_id, config";

interface AgentRow {
  name: string;
  model: string | null;
  timeout_minutes: number | null;
  prompt: string | null;
  image: string | null;
  execution_mode: string;
  review_required: boolean;
  project_id: string | null;
  config: AgentDefinition["config"];
}

const toDef = (r: AgentRow): AgentDefinition => ({
  name: r.name,
  model: r.model,
  timeout_minutes: r.timeout_minutes,
  prompt: r.prompt,
  image: r.image,
  execution_mode: r.execution_mode,
  review_required: r.review_required,
  project_id: r.project_id,
  config: r.config ?? null,
});

const split = (rows: AgentRow[]) => ({
  project: rows.find((r) => r.project_id !== null) ?? null,
  org: rows.find((r) => r.project_id === null) ?? null,
});

/**
 * The effective definition for a catalog entry addressed the way the
 * catalog-events feed addresses it — by `(name, projectId)`, no repo full_name
 * in hand. A named projectId whose override row is gone resolves to null (the
 * reader deletes the CRD pair); an org entry falls through to the yaml layer,
 * the same safety net PgAgentDefs.resolve keeps.
 */
export async function resolveCatalogEntry(
  pool: PgPool,
  base: AgentDefsPort,
  name: string,
  projectId: string | null,
): Promise<AgentDefinition | null> {
  const { rows } = await pool.query<AgentRow>(
    `SELECT ${JOIN_COLS} FROM lore.agent_definitions a
      WHERE a.name = $1 AND (a.project_id IS NULL OR a.project_id = $2)`,
    [name, projectId],
  );
  const { project, org } = split(rows as AgentRow[]);

  if (projectId !== null && !project) {
    return null;
  }
  const yamlDefault = await base.resolve("", name);

  return resolveAgentConfig(
    project ? toDef(project) : null,
    org ? toDef(org) : null,
    yamlDefault,
  );
}

/**
 * The stationRef a dispatch for `repo` should carry for a catalog base name:
 * the project-qualified CRD name when the repo holds an override row, the bare
 * name otherwise. Per-repo overrides render under qualified CRD names (two
 * repos overriding one task type used to silently replace each other's CR),
 * so the dispatch side must point at the same spelling the sync loop applied.
 */
export async function qualifiedStationRef(
  pool: PgPool,
  baseName: string,
  repo: string,
): Promise<string> {
  // An override only earns the qualified name if some cluster actually applied
  // its CR. A row every cluster REFUSED — a model whose credential family none
  // of them holds, say — has no CR and never will, so pointing dispatch at the
  // qualified name would send every run at a stationRef that cannot resolve.
  //
  // That is not hypothetical: it took central's reviews down on 2026-09-01.
  // Qualification alone was safe, and refusing to render an unservable recipe
  // was safe; together they turned "runs on the org default" — the wrong model
  // but a working one — into "Station or AgentDefinition not found". The
  // fallback is deliberately silent HERE and loud on the /agents page, where
  // the Rollout column names the cluster and the reason (FR9.6): a review that
  // runs on the org default beats no review, as long as nobody has to guess why.
  //
  // Absence of a verdict is NOT refusal: a cluster that has not reported yet
  // (or an older agent that never reports) leaves no rows, and the override
  // keeps its qualified name exactly as before.
  const { rows } = await pool.query<{ project_id: string }>(
    `SELECT a.project_id FROM lore.agent_definitions a
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
        )`,
    [baseName, repo],
  );
  const projectId = (rows[0] as { project_id: string } | undefined)?.project_id;

  return catalogCrdName(baseName, projectId ?? null);
}

export class PgAgentDefs implements AgentDefsPort {
  constructor(
    private readonly pool: PgPool,
    /** task-types.yaml fallback — the bottom precedence layer (prompt etc.). */
    private readonly base: AgentDefsPort,
  ) {}

  async resolve(repo: string, name: string): Promise<AgentDefinition | null> {
    const { rows } = await this.pool.query<AgentRow>(
      `SELECT ${JOIN_COLS} FROM lore.agent_definitions a
         LEFT JOIN lore.repos r ON r.id = a.project_id
        WHERE a.name = $1 AND (a.project_id IS NULL OR r.full_name = $2)`,
      [name, repo],
    );
    const { project, org } = split(rows as AgentRow[]);
    const yamlDefault = await this.base.resolve(repo, name);

    return resolveAgentConfig(
      project ? toDef(project) : null,
      org ? toDef(org) : null,
      yamlDefault,
    );
  }

  async list(repo: string): Promise<AgentDefinition[]> {
    const { rows } = await this.pool.query<AgentRow>(
      `SELECT ${JOIN_COLS} FROM lore.agent_definitions a
         LEFT JOIN lore.repos r ON r.id = a.project_id
        WHERE a.project_id IS NULL OR r.full_name = $1`,
      [repo],
    );
    const byName = new Map<string, AgentRow[]>();

    for (const r of rows as AgentRow[]) {
      const list = byName.get(r.name) ?? [];

      list.push(r);
      byName.set(r.name, list);
    }
    const baseDefs = await this.base.list(repo);
    const names = new Set<string>([
      ...baseDefs.map((d) => d.name),
      ...byName.keys(),
    ]);
    const out: AgentDefinition[] = [];

    for (const name of names) {
      const group = byName.get(name) ?? [];
      const { project, org } = split(group);
      const resolved = resolveAgentConfig(
        project ? toDef(project) : null,
        org ? toDef(org) : null,
        baseDefs.find((d) => d.name === name) ?? null,
      );

      if (resolved) {
        out.push(resolved);
      }
    }

    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  async create(
    repo: string,
    def: AgentDefinitionInput,
  ): Promise<AgentDefinition> {
    // The written CTE row and the catalog_events append land in ONE statement,
    // so a definition can never exist without the change event the
    // cluster-agents' sync loops tail (and vice versa).
    const { rows } = await this.pool.query(
      `WITH written AS (
         INSERT INTO lore.agent_definitions
           (name, model, timeout_minutes, prompt, image, execution_mode, review_required, config, project_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, (SELECT id FROM lore.repos WHERE full_name = $9))
         RETURNING ${RET_COLS}
       ), event AS (
         INSERT INTO lore.catalog_events (name, project_id, op)
         SELECT name, project_id, 'upsert' FROM written
       )
       SELECT ${RET_COLS} FROM written`,
      [
        def.name,
        def.model,
        def.timeout_minutes,
        def.prompt,
        def.image,
        def.execution_mode,
        def.review_required,
        def.config ?? null,
        repo,
      ],
    );

    return toDef(rows[0] as unknown as AgentRow);
  }

  async update(
    repo: string,
    name: string,
    patch: Partial<AgentDefinitionInput>,
  ): Promise<AgentDefinition> {
    // Upsert the project row so editing an inherited org default forks a row.
    const { rows } = await this.pool.query(
      `WITH written AS (
         INSERT INTO lore.agent_definitions
           (name, model, timeout_minutes, prompt, image, execution_mode, review_required, config, project_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, (SELECT id FROM lore.repos WHERE full_name = $9))
         ON CONFLICT (name, project_id) WHERE project_id IS NOT NULL DO UPDATE SET
           model = EXCLUDED.model,
           timeout_minutes = EXCLUDED.timeout_minutes,
           prompt = EXCLUDED.prompt,
           image = EXCLUDED.image,
           execution_mode = EXCLUDED.execution_mode,
           review_required = EXCLUDED.review_required,
           config = EXCLUDED.config,
           updated_at = now()
         RETURNING ${RET_COLS}
       ), event AS (
         INSERT INTO lore.catalog_events (name, project_id, op)
         SELECT name, project_id, 'upsert' FROM written
       )
       SELECT ${RET_COLS} FROM written`,
      [
        name,
        patch.model ?? null,
        patch.timeout_minutes ?? null,
        patch.prompt ?? null,
        patch.image ?? null,
        patch.execution_mode ?? "claude-code",
        patch.review_required ?? false,
        patch.config ?? null,
        repo,
      ],
    );

    return toDef(rows[0] as unknown as AgentRow);
  }

  async delete(repo: string, name: string): Promise<void> {
    await this.pool.query(
      `WITH removed AS (
         DELETE FROM lore.agent_definitions
          WHERE name = $1
            AND project_id = (SELECT id FROM lore.repos WHERE full_name = $2)
         RETURNING name, project_id
       )
       INSERT INTO lore.catalog_events (name, project_id, op)
       SELECT name, project_id, 'delete' FROM removed`,
      [name, repo],
    );
  }
}
