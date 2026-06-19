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

// Recipe fields added in ADR-030. Order matches AGENT_INSERT_COLS / the param lists below.
const RECIPE_COLS =
  "description, api_version, append_system_prompt, allowed_tools, disallowed_tools, permission_mode, max_turns, resources, output, tool_config";
// Qualified with the `a` alias: the resolve/list queries LEFT JOIN lore.repos,
// which also has `name`/`id` columns, so unqualified selects are ambiguous.
const JOIN_COLS =
  `a.name, a.model, a.timeout_minutes, a.prompt, a.image, a.execution_mode, a.review_required, a.project_id, ${RECIPE_COLS
    .split(", ")
    .map((c) => `a.${c}`)
    .join(", ")}`;
// Unqualified for INSERT ... RETURNING (single table, no alias in scope).
const RET_COLS =
  `name, model, timeout_minutes, prompt, image, execution_mode, review_required, project_id, ${RECIPE_COLS}`;

interface AgentRow {
  name: string;
  model: string | null;
  timeout_minutes: number | null;
  prompt: string | null;
  image: string | null;
  execution_mode: string;
  review_required: boolean;
  project_id: string | null;
  description: string | null;
  api_version: string | null;
  append_system_prompt: string | null;
  allowed_tools: string[] | null;
  disallowed_tools: string[] | null;
  permission_mode: "auto" | "bypass" | null;
  max_turns: number | null;
  resources: AgentDefinition["resources"] | null;
  output: AgentDefinition["output"] | null;
  tool_config: Record<string, unknown> | null;
}

/** JSONB columns must be stringified — node-pg renders JS arrays as Postgres array literals. */
const j = (v: unknown): string | null => (v == null ? null : JSON.stringify(v));

const toDef = (r: AgentRow): AgentDefinition => ({
  name: r.name,
  model: r.model,
  timeout_minutes: r.timeout_minutes,
  prompt: r.prompt,
  image: r.image,
  execution_mode: r.execution_mode,
  review_required: r.review_required,
  project_id: r.project_id,
  description: r.description,
  api_version: r.api_version,
  append_system_prompt: r.append_system_prompt,
  allowed_tools: r.allowed_tools,
  disallowed_tools: r.disallowed_tools,
  permission_mode: r.permission_mode,
  max_turns: r.max_turns,
  resources: r.resources,
  output: r.output,
  tool_config: r.tool_config,
});

const split = (rows: AgentRow[]) => ({
  project: rows.find((r) => r.project_id !== null) ?? null,
  org: rows.find((r) => r.project_id === null) ?? null,
});

// Shared INSERT shape for create + update (upsert). project_id resolves from the repo full_name.
const INSERT_COLS = `name, model, timeout_minutes, prompt, image, execution_mode, review_required, project_id, ${RECIPE_COLS}`;
const INSERT_VALS =
  "$1, $2, $3, $4, $5, $6, $7, (SELECT id FROM lore.repos WHERE full_name = $8), $9, $10, $11, $12, $13, $14, $15, $16, $17, $18";
const UPDATE_SET = [
  "model",
  "timeout_minutes",
  "prompt",
  "image",
  "execution_mode",
  "review_required",
  ...RECIPE_COLS.split(", "),
]
  .map((c) => `${c} = EXCLUDED.${c}`)
  .concat("updated_at = now()")
  .join(",\n         ");

const insertParams = (
  d: Partial<AgentDefinitionInput> & { name: string },
  repo: string,
): unknown[] => [
  d.name,
  d.model ?? null,
  d.timeout_minutes ?? null,
  d.prompt ?? null,
  d.image ?? null,
  d.execution_mode ?? "claude-code",
  d.review_required ?? false,
  repo,
  d.description ?? null,
  d.api_version ?? null,
  d.append_system_prompt ?? null,
  j(d.allowed_tools),
  j(d.disallowed_tools),
  d.permission_mode ?? null,
  d.max_turns ?? null,
  j(d.resources),
  j(d.output),
  j(d.tool_config),
];

export class PgAgentDefs implements AgentDefsPort {
  constructor(
    private readonly pool: PgPool,
    /** task-types.yaml fallback — the bottom precedence layer (prompt etc.). */
    private readonly base: AgentDefsPort,
  ) {}

  async resolve(repo: string, name: string): Promise<AgentDefinition | null> {
    const { rows } = await this.pool.query(
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
    const { rows } = await this.pool.query(
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
    const names = new Set<string>([...baseDefs.map((d) => d.name), ...byName.keys()]);
    const out: AgentDefinition[] = [];
    for (const name of names) {
      const group = byName.get(name) ?? [];
      const { project, org } = split(group);
      const resolved = resolveAgentConfig(
        project ? toDef(project) : null,
        org ? toDef(org) : null,
        baseDefs.find((d) => d.name === name) ?? null,
      );
      if (resolved) out.push(resolved);
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  async create(repo: string, def: AgentDefinitionInput): Promise<AgentDefinition> {
    const { rows } = await this.pool.query(
      `INSERT INTO lore.agent_definitions (${INSERT_COLS})
       VALUES (${INSERT_VALS})
       RETURNING ${RET_COLS}`,
      insertParams(def, repo),
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
      `INSERT INTO lore.agent_definitions (${INSERT_COLS})
       VALUES (${INSERT_VALS})
       ON CONFLICT (name, project_id) WHERE project_id IS NOT NULL DO UPDATE SET
         ${UPDATE_SET}
       RETURNING ${RET_COLS}`,
      insertParams({ ...patch, name }, repo),
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
