import type { PgPool } from "../../memory-store.js";
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
  "a.name, a.model, a.timeout_minutes, a.prompt, a.image, a.execution_mode, a.review_required, a.project_id";
// Unqualified for INSERT ... RETURNING (single table, no alias in scope).
const RET_COLS =
  "name, model, timeout_minutes, prompt, image, execution_mode, review_required, project_id";

interface AgentRow {
  name: string;
  model: string | null;
  timeout_minutes: number | null;
  prompt: string | null;
  image: string | null;
  execution_mode: string;
  review_required: boolean;
  project_id: string | null;
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
});

const split = (rows: AgentRow[]) => ({
  project: rows.find((r) => r.project_id !== null) ?? null,
  org: rows.find((r) => r.project_id === null) ?? null,
});

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
    const { rows } = await this.pool.query(
      `INSERT INTO lore.agent_definitions
         (name, model, timeout_minutes, prompt, image, execution_mode, review_required, project_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, (SELECT id FROM lore.repos WHERE full_name = $8))
       RETURNING ${RET_COLS}`,
      [
        def.name,
        def.model,
        def.timeout_minutes,
        def.prompt,
        def.image,
        def.execution_mode,
        def.review_required,
        repo,
      ],
    );

    return toDef(rows[0] as AgentRow);
  }

  async update(
    repo: string,
    name: string,
    patch: Partial<AgentDefinitionInput>,
  ): Promise<AgentDefinition> {
    // Upsert the project row so editing an inherited org default forks a row.
    const { rows } = await this.pool.query(
      `INSERT INTO lore.agent_definitions
         (name, model, timeout_minutes, prompt, image, execution_mode, review_required, project_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, (SELECT id FROM lore.repos WHERE full_name = $8))
       ON CONFLICT (name, project_id) WHERE project_id IS NOT NULL DO UPDATE SET
         model = EXCLUDED.model,
         timeout_minutes = EXCLUDED.timeout_minutes,
         prompt = EXCLUDED.prompt,
         image = EXCLUDED.image,
         execution_mode = EXCLUDED.execution_mode,
         review_required = EXCLUDED.review_required,
         updated_at = now()
       RETURNING ${RET_COLS}`,
      [
        name,
        patch.model ?? null,
        patch.timeout_minutes ?? null,
        patch.prompt ?? null,
        patch.image ?? null,
        patch.execution_mode ?? "claude-code",
        patch.review_required ?? false,
        repo,
      ],
    );

    return toDef(rows[0] as AgentRow);
  }

  async delete(repo: string, name: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM lore.agent_definitions
        WHERE name = $1
          AND project_id = (SELECT id FROM lore.repos WHERE full_name = $2)`,
      [name, repo],
    );
  }
}
