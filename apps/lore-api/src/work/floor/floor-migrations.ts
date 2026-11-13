// Floor migrations: one file each under ./migrations, run once at boot after seeding, in version order, and recorded in lore.schema_migrations as `floor/<file>` beside the SQL migrations. Boot seeding never overwrites an agent the floor holds (#3995), so a changed shipped prompt reaches the floor as a one-line `updatePrompt(agent, file)` here, and a changed shipped timeout as `updateTimeout(agent, file)`.
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { floorClientFrom } from "@re-cinq/lore-shared/floor/floor-client.js";
import { FloorAgentDefs } from "@re-cinq/lore-shared/project/agents/agent-defs-floor.js";
import { shippedFloorAgents } from "@re-cinq/lore-shared/project/agents/pipeline-agents.js";
import { skillsSourceWrite } from "../agents/skills-source.js";
import type { SeedFailure } from "./seed-floor-pipelines.js";

export interface FloorMigrationApi {
  /** Writes the prompt of libs/shared/src/agent-defaults/<file> as the agent's org default on the floor. */
  updatePrompt(agent: string, file: string): Promise<void>;
  /** Writes the `timeout_minutes` of libs/shared/src/agent-defaults/<file> as the agent's org default on the floor. */
  updateTimeout(agent: string, file: string): Promise<void>;
  /** Writes the `config.skills` of libs/shared/src/agent-defaults/<file> as the agent's org default on the floor, with the skills source when it has none. */
  updateSkills(agent: string, file: string): Promise<void>;
}

export type FloorMigration = (floor: FloorMigrationApi) => Promise<void>;

export interface NamedFloorMigration {
  version: string;
  migrate: FloorMigration;
}

export interface FloorMigrationDeps {
  migrations(): Promise<NamedFloorMigration[]>;
  applied(): Promise<string[]>;
  floor: FloorMigrationApi;
  markApplied(version: string): Promise<void>;
}

export interface FloorMigrationsRun {
  applied: string[];
  failed: SeedFailure | null;
}

/** Stops at the first failure, as the SQL migrations do: a later migration may build on it, and the next boot runs it again. */
export async function runFloorMigrations(
  deps: FloorMigrationDeps,
): Promise<FloorMigrationsRun> {
  const done = new Set(await deps.applied());
  const pending = (await deps.migrations())
    .filter((named) => !done.has(named.version))
    .sort((a, b) => a.version.localeCompare(b.version));
  const run: FloorMigrationsRun = { applied: [], failed: null };

  for (const { version, migrate } of pending) {
    try {
      await migrate(deps.floor);
      await deps.markApplied(version);
      run.applied.push(version);
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);

      return { ...run, failed: { name: version, reason } };
    }
  }

  return run;
}

const MIGRATION_FILE = /^(\d{4}_[\w-]+)\.(?:js|ts)$/;

export async function readFloorMigrations(): Promise<NamedFloorMigration[]> {
  const dir = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "migrations",
  );
  const files = (await readdir(dir)).filter((name) =>
    MIGRATION_FILE.test(name),
  );

  return Promise.all(
    files.map(async (name) => ({
      version: `floor/${name.replace(MIGRATION_FILE, "$1")}`,
      migrate: (
        (await import(path.join(dir, name))) as { migrate: FloorMigration }
      ).migrate,
    })),
  );
}

export function productionFloorMigrationDeps(
  pool: Pool,
  env: Record<string, string | undefined> = process.env,
): FloorMigrationDeps {
  return {
    migrations: readFloorMigrations,
    ...ledgerOf(pool),
    floor: floorApiOf(env),
  };
}

function ledgerOf(
  pool: Pool,
): Pick<FloorMigrationDeps, "applied" | "markApplied"> {
  return {
    applied: async () =>
      (
        await pool.query<{ version: string }>(
          "SELECT version FROM lore.schema_migrations WHERE version LIKE 'floor/%'",
        )
      ).rows.map((row) => row.version),
    markApplied: async (version) => {
      await pool.query(
        "INSERT INTO lore.schema_migrations (version) VALUES ($1)",
        [version],
      );
    },
  };
}

function floorApiOf(
  env: Record<string, string | undefined>,
): FloorMigrationApi {
  return floorApiFor(new FloorAgentDefs(floorClientFrom(env).agentDefinitions));
}

/** What a migration may do to the floor's agents, each value read from the agent's shipped md file. */
export function floorApiFor(agentDefs: FloorAgentDefs): FloorMigrationApi {
  const shipped = shippedFloorAgents();

  return {
    updatePrompt: async (agent, file) => {
      await agentDefs.updateOrg(agent, { prompt: promptOf(shipped, file) });
    },
    updateTimeout: async (agent, file) => {
      await agentDefs.updateOrg(agent, {
        timeout_minutes: timeoutOf(shipped, file),
      });
    },
    updateSkills: async (agent, file) =>
      await updateOrgSkills(agentDefs, agent, skillsOf(shipped, file)),
  };
}

type ShippedAgents = ReturnType<typeof shippedFloorAgents>;

function promptOf(shipped: ShippedAgents, file: string): string {
  const prompt = shipped.get(path.basename(file, ".md"))?.prompt;

  enforceTrue(prompt, Error, `no shipped agent file ${file} has a prompt`);

  return prompt;
}

function timeoutOf(shipped: ShippedAgents, file: string): number {
  const minutes = shipped.get(path.basename(file, ".md"))?.timeout_minutes;

  enforceTrue(
    typeof minutes === "number",
    Error,
    `no shipped agent file ${file} has a timeout_minutes`,
  );

  return minutes;
}

async function updateOrgSkills(
  agentDefs: FloorAgentDefs,
  agent: string,
  skills: string[],
): Promise<void> {
  await agentDefs.updateOrg(
    agent,
    {},
    { skills, ...skillsSourceWrite(), inheritedConfig: null },
  );
}

function skillsOf(shipped: ShippedAgents, file: string): string[] {
  const settings = shipped.get(path.basename(file, ".md"));
  const skills = settings?.config?.skills;

  enforceTrue(
    Array.isArray(skills) && skills.length > 0,
    Error,
    `no shipped agent file ${file} has a skills list`,
  );

  return skills;
}
