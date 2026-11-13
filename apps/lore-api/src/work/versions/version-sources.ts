import { parse } from "yaml";
import { z } from "zod";
import type { Pool } from "pg";
import type { FloorClient } from "@re-cinq/floor-client";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { floorIfConfigured } from "@re-cinq/lore-shared/floor/floor-client.js";
import { PgServiceVersions } from "@re-cinq/lore-shared/project/service-versions/service-versions-pg.js";
import {
  readFloorPipelineFiles,
  type PipelineText,
} from "../floor/seed-floor-pipelines.js";
import type { VersionSources } from "./versions-answer.js";

const UI_TIMEOUT_MS = 5_000;

const UiVersionWire = z.object({
  version: z.string(),
  packages: z.record(z.string(), z.string()).default({}),
});

/** Where each part of GET /api/versions is read in production: the service table and schema_migrations on the pool, the ui's public version route, and the floor. */
export function productionVersionSources(
  pool: Pool | null,
  env: Record<string, string | undefined> = process.env,
): VersionSources {
  const floor = floorIfConfigured();

  return {
    services: () => new PgServiceVersions(livePool(pool)).list(),
    ui: () => readUiVersion(env.LORE_UI_INTERNAL_URL || env.LORE_UI_URL, fetch),
    floorVersion: () => liveFloor(floor).health.version(),
    migrations: () => latestMigrations(livePool(pool)),
    onFloor: async () =>
      readOnFloor(liveFloor(floor), lineIdsOf(await readFloorPipelineFiles())),
    env: {
      LORE_BUILD_SHA: env.LORE_BUILD_SHA,
      LORE_AGENT_IMAGE: env.LORE_AGENT_IMAGE,
    },
  };
}

function livePool(pool: Pool | null): Pool {
  enforceTrue(pool, Error, "database unavailable");

  return pool;
}

function liveFloor(floor: FloorClient | null): FloorClient {
  enforceTrue(floor, Error, "no floor configured");

  return floor;
}

export function lineIdsOf(files: PipelineText[]): string[] {
  return files.map(
    (file) => (parse(file.text) as { line: { id: string } }).line.id,
  );
}

export async function readUiVersion(
  url: string | undefined,
  fetchFn: (url: string, init: RequestInit) => Promise<Response>,
): Promise<{ build: string; packages: Record<string, string> }> {
  enforceTrue(url, Error, "no ui url configured");
  const response = await fetchFn(`${url}/api/version`, {
    signal: AbortSignal.timeout(UI_TIMEOUT_MS),
  });

  enforceTrue(response.ok, Error, `lore-ui answered HTTP ${response.status}`);
  const wire = UiVersionWire.parse(await response.json());

  return { build: wire.version, packages: wire.packages };
}

const LATEST_MIGRATIONS_SQL = `
  SELECT max(version) FILTER (WHERE version ~ '^[0-9]{4}_.*[.]sql$') AS migration,
         max(version) FILTER (WHERE version LIKE 'floor/%') AS floor_migration
    FROM lore.schema_migrations`;

export async function latestMigrations(
  pool: Pool,
): Promise<{ migration: string | null; floorMigration: string | null }> {
  const { rows } = await pool.query<{
    migration: string | null;
    floor_migration: string | null;
  }>(LATEST_MIGRATIONS_SQL);

  return {
    migration: rows[0]?.migration ?? null,
    floorMigration: rows[0]?.floor_migration ?? null,
  };
}

export async function readOnFloor(
  floor: FloorClient,
  lineIds: string[],
): Promise<{
  pipelines: Array<{ id: string; hash: string | null }>;
  agentDefinitions: number;
}> {
  const [pipelines, agents] = await Promise.all([
    Promise.all(
      lineIds.map(async (id) => ({
        id,
        hash: (await floor.lines.get(id))?.hash ?? null,
      })),
    ),
    floor.agentDefinitions.list(),
  ]);

  return { pipelines, agentDefinitions: agents.length };
}
