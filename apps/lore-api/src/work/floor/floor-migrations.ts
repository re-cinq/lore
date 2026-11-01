// Floor migrations: one file each under ./migrations, run once at boot after seeding, in version order, and recorded in lore.schema_migrations as `floor/<file>` beside the SQL migrations. Boot seeding never overwrites an agent the floor holds (#3995), so a changed shipped prompt reaches the floor as a one-line `updatePrompt(agent, file)` here.
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { floorClientFrom } from "@re-cinq/lore-shared/floor/floor-client.js";
import { FloorAgentDefs } from "@re-cinq/lore-shared/project/agents/agent-defs-floor.js";
import { shippedAgentPrompts } from "@re-cinq/lore-shared/project/agents/pipeline-agents.js";
import type { SeedFailure } from "./seed-floor-pipelines.js";

export interface FloorMigrationApi {
  /** Writes the prompt of libs/shared/src/agent-defaults/<file> as the agent's org default on the floor. */
  updatePrompt(agent: string, file: string): Promise<void>;
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
  const agentDefs = new FloorAgentDefs(floorClientFrom(env).agentDefinitions);
  const prompts = shippedAgentPrompts();

  return {
    updatePrompt: async (agent, file) => {
      const prompt = prompts.get(path.basename(file, ".md"));

      enforceTrue(prompt, Error, `no shipped agent file ${file} has a prompt`);

      await agentDefs.updateOrg(agent, { prompt });
    },
  };
}
