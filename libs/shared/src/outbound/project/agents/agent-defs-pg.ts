import type { PgPool } from "../../memory-store.js";
import { catalogCrdName } from "./agent-crd.js";
import {
  resolveAgentConfig,
  type AgentDefinition,
  type AgentDefinitionInput,
  type AgentDefsPort,
  type PodResourcesWrite,
} from "./agent-defs-port.js";
import {
  CATALOG_ENTRY_SQL,
  CREATE_DEF_SQL,
  DELETE_DEF_SQL,
  LIST_DEFS_SQL,
  QUALIFIED_STATION_SQL,
  RESOLVE_DEF_SQL,
  UPDATE_DEF_SQL,
  UPDATE_ORG_DEF_SQL,
} from "./agent-defs-sql.js";

// AgentDefsPort over lore.agent_definitions via resolveAgentConfig three-layer merge (project → org → yaml); pods use AgentDefsHttp.

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

/** The three trailing bind values the merged-config SQL reads: touched, inherited, block. */
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
    patch.review_required ?? false,
    withDefault(patch.config, null),
  ];
}

/** The nine create binds, in statement order. */
function createParams(def: AgentDefinitionInput, repo: string): unknown[] {
  return [
    def.name,
    def.model,
    def.timeout_minutes,
    def.prompt,
    def.image,
    def.execution_mode,
    def.review_required,
    def.config ?? null,
    repo,
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

/** Every name either layer knows about, resolved through the three-layer merge and sorted. */
function mergeDefinitions(
  byName: Map<string, AgentRow[]>,
  baseDefs: AgentDefinition[],
): AgentDefinition[] {
  const names = new Set<string>([
    ...baseDefs.map((d) => d.name),
    ...byName.keys(),
  ]);

  return [...names]
    .map((name) =>
      resolveGroupedDefinition(
        byName.get(name) ?? [],
        baseDefs.find((d) => d.name === name) ?? null,
      ),
    )
    .filter((d): d is AgentDefinition => d !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Effective definition for catalog entry by (name, projectId); missing override or org entry falls through to yaml layer.
export async function resolveCatalogEntry(
  pool: PgPool,
  base: AgentDefsPort,
  name: string,
  projectId: string | null,
): Promise<AgentDefinition | null> {
  const { rows } = await pool.query<AgentRow>(CATALOG_ENTRY_SQL, [
    name,
    projectId,
  ]);

  if (projectId !== null && !split(rows as AgentRow[]).project) {
    return null;
  }

  return resolveGroupedDefinition(
    rows as AgentRow[],
    await base.resolve("", name),
  );
}

// Dispatch stationRef for repo: project-qualified CRD name if override exists, bare name otherwise.
export async function qualifiedStationRef(
  pool: PgPool,
  baseName: string,
  repo: string,
): Promise<string> {
  const { rows } = await pool.query<{ project_id: string }>(
    QUALIFIED_STATION_SQL,
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
  const { rows } = await pool.query(UPDATE_ORG_DEF_SQL, [
    patch.name,
    ...patchDefaults(patch),
    ...podResourcesParams(podResources),
  ]);

  return toDef(rows[0] as unknown as AgentRow);
}

export class PgAgentDefs implements AgentDefsPort {
  constructor(
    private readonly pool: PgPool,
    /** task-types.yaml fallback — the bottom precedence layer (prompt etc.). */
    private readonly base: AgentDefsPort,
  ) {}

  async resolve(repo: string, name: string): Promise<AgentDefinition | null> {
    const { rows } = await this.pool.query<AgentRow>(RESOLVE_DEF_SQL, [
      name,
      repo,
    ]);
    const { project, org } = split(rows as AgentRow[]);
    const yamlDefault = await this.base.resolve(repo, name);

    return resolveAgentConfig(
      project ? toDef(project) : null,
      org ? toDef(org) : null,
      yamlDefault,
    );
  }

  async list(repo: string): Promise<AgentDefinition[]> {
    const { rows } = await this.pool.query<AgentRow>(LIST_DEFS_SQL, [repo]);
    const byName = groupByName(rows as AgentRow[]);

    return mergeDefinitions(byName, await this.base.list(repo));
  }

  async create(
    repo: string,
    def: AgentDefinitionInput,
  ): Promise<AgentDefinition> {
    const { rows } = await this.pool.query(
      CREATE_DEF_SQL,
      createParams(def, repo),
    );

    return toDef(rows[0] as unknown as AgentRow);
  }

  async update(
    repo: string,
    name: string,
    patch: Partial<AgentDefinitionInput>,
    podResources?: PodResourcesWrite,
  ): Promise<AgentDefinition> {
    const { rows } = await this.pool.query(UPDATE_DEF_SQL, [
      name,
      ...patchDefaults(patch),
      repo,
      ...podResourcesParams(podResources),
    ]);

    return toDef(rows[0] as unknown as AgentRow);
  }

  async delete(repo: string, name: string): Promise<void> {
    await this.pool.query(DELETE_DEF_SQL, [name, repo]);
  }
}
