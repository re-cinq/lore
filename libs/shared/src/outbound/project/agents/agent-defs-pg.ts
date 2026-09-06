import type { PgPool } from "../../memory-store.js";
import { catalogCrdName } from "./agent-crd.js";
import {
  resolveAgentConfig,
  type AgentDefinition,
  type AgentDefinitionInput,
  type AgentDefsPort,
  type PodResourcesWrite,
} from "./agent-defs-port.js";

// AgentDefsPort over lore.agent_definitions via resolveAgentConfig three-layer merge (project → org → yaml); pods use AgentDefsHttp.

// Qualified with `a` alias: resolve/list queries LEFT JOIN lore.repos (unqualified selects would be ambiguous).
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

/** The three trailing bind values mergedConfigSql reads: touched, inherited, block. */
const podResourcesParams = (
  write: PodResourcesWrite | undefined,
): [boolean, Record<string, unknown> | null, Record<string, unknown> | null] =>
  write
    ? [
        true,
        write.inheritedConfig,
        write.podResources ? { pod_resources: write.podResources } : null,
      ]
    : [false, null, null];

const split = (rows: AgentRow[]) => ({
  project: rows.find((r) => r.project_id !== null) ?? null,
  org: rows.find((r) => r.project_id === null) ?? null,
});

function withDefault<T>(value: T | undefined, fallback: T): T {
  return value ?? fallback;
}

/** The seven defaulted columns shared by the org-default and per-repo upsert statements, in bind order. */
function patchDefaults(patch: Partial<AgentDefinitionInput>): unknown[] {
  return [
    withDefault(patch.model, null),
    withDefault(patch.timeout_minutes, null),
    withDefault(patch.prompt, null),
    withDefault(patch.image, null),
    withDefault(patch.execution_mode, "claude-code"),
    withDefault(patch.review_required, false),
    withDefault(patch.config, null),
  ];
}

function groupByName(rows: AgentRow[]): Map<string, AgentRow[]> {
  const byName = new Map<string, AgentRow[]>();

  for (const r of rows) {
    const group = byName.get(r.name) ?? [];

    group.push(r);
    byName.set(r.name, group);
  }

  return byName;
}

function resolveGroupedDefinition(
  group: AgentRow[],
  baseDef: AgentDefinition | null,
): AgentDefinition | null {
  const { project, org } = split(group);

  return resolveAgentConfig(
    project ? toDef(project) : null,
    org ? toDef(org) : null,
    baseDef,
  );
}

// Effective definition for catalog entry by (name, projectId); missing override or org entry falls through to yaml layer.
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

// Dispatch stationRef for repo: project-qualified CRD name if override exists, bare name otherwise.
export async function qualifiedStationRef(
  pool: PgPool,
  baseName: string,
  repo: string,
): Promise<string> {
  // Override earns qualified name only if cluster applied its CR; prevents dispatch at unresolvable stationRef (2026-09-01 outage).
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

// Upsert ORG-DEFAULT row (project_id IS NULL) — writes catalog event for cluster-agents to see.
export async function updateOrgDefinition(
  pool: PgPool,
  patch: AgentDefinitionInput,
  podResources?: PodResourcesWrite,
): Promise<AgentDefinition> {
  const { rows } = await pool.query(
    `WITH written AS (
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
     SELECT ${RET_COLS} FROM written`,
    [patch.name, ...patchDefaults(patch), ...podResourcesParams(podResources)],
  );

  return toDef(rows[0] as unknown as AgentRow);
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
    const byName = groupByName(rows as AgentRow[]);
    const baseDefs = await this.base.list(repo);
    const names = new Set<string>([
      ...baseDefs.map((d) => d.name),
      ...byName.keys(),
    ]);
    const out: AgentDefinition[] = [];

    for (const name of names) {
      const baseDef = baseDefs.find((d) => d.name === name) ?? null;
      const resolved = resolveGroupedDefinition(
        byName.get(name) ?? [],
        baseDef,
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
    // Written CTE row and catalog_events append land in ONE statement — definition cannot exist without change event.
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
    podResources?: PodResourcesWrite,
  ): Promise<AgentDefinition> {
    // Upsert the project row so editing an inherited org default forks a row.
    const { rows } = await this.pool.query(
      `WITH written AS (
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
       SELECT ${RET_COLS} FROM written`,
      [
        name,
        ...patchDefaults(patch),
        repo,
        ...podResourcesParams(podResources),
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
