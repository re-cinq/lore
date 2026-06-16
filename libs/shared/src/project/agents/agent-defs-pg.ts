import type { PgPool } from "../../memory-store.js";
import {
  resolveAgentConfig,
  type AgentDefinition,
  type AgentDefinitionInput,
  type AgentDefsPort,
} from "./agent-defs-port.js";

/**
 * AgentDefsPort over lore.agents. resolve/list field-merge the repo's project
 * row over the org default (project_id null) via the pure resolveAgentConfig.
 * Writes target the repo's project row (org defaults are seeded/edited through
 * the org path). The pod never reaches this adapter — it uses AgentDefsHttp.
 */

const COLS =
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
  constructor(private readonly pool: PgPool) {}

  async resolve(repo: string, name: string): Promise<AgentDefinition | null> {
    const { rows } = await this.pool.query(
      `SELECT ${COLS} FROM lore.agents a
         LEFT JOIN lore.repos r ON r.id = a.project_id
        WHERE a.name = $1 AND (a.project_id IS NULL OR r.full_name = $2)`,
      [name, repo],
    );
    const { project, org } = split(rows as AgentRow[]);
    return resolveAgentConfig(
      project ? toDef(project) : null,
      org ? toDef(org) : null,
      null,
    );
  }

  async list(repo: string): Promise<AgentDefinition[]> {
    const { rows } = await this.pool.query(
      `SELECT ${COLS} FROM lore.agents a
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
    const out: AgentDefinition[] = [];
    for (const group of byName.values()) {
      const { project, org } = split(group);
      const resolved = resolveAgentConfig(
        project ? toDef(project) : null,
        org ? toDef(org) : null,
        null,
      );
      if (resolved) out.push(resolved);
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  async create(repo: string, def: AgentDefinitionInput): Promise<AgentDefinition> {
    const { rows } = await this.pool.query(
      `INSERT INTO lore.agents
         (name, model, timeout_minutes, prompt, image, execution_mode, review_required, project_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, (SELECT id FROM lore.repos WHERE full_name = $8))
       RETURNING ${COLS}`,
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
      `INSERT INTO lore.agents
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
       RETURNING ${COLS}`,
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
      `DELETE FROM lore.agents
        WHERE name = $1
          AND project_id = (SELECT id FROM lore.repos WHERE full_name = $2)`,
      [name, repo],
    );
  }
}
