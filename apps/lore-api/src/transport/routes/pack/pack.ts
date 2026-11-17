import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import {
  PackSyncResultSchema,
  PackSyncStateSchema,
} from "@re-cinq/lore-shared/models/pack-sync-state.js";
import { readPackSync } from "@re-cinq/lore-shared/project/settings/pack-sync-store.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodResponse } from "../../http/zod-response.js";
import { withPool } from "../with-pool.js";
import { syncProductionPack } from "../../../work/pack/production-pack-deps.js";
import {
  packConfig,
  type PackConfig,
} from "@re-cinq/lore-shared/pack-config.js";
import type { PackSyncResult } from "../../../work/pack/sync-pack.js";

export interface PackSeams {
  config(): PackConfig | null;
  readSync(pool: Pool): ReturnType<typeof readPackSync>;
  sync(pool: Pool): Promise<PackSyncResult>;
}

const production: PackSeams = {
  config: () => packConfig(process.env),
  readSync: readPackSync,
  sync: syncProductionPack,
};

const PackSchema = z.object({
  configured: z.boolean(),
  repo: z.string().nullable(),
  ref: z.string().nullable(),
  sync: PackSyncStateSchema.nullable(),
});

/** The client's pack repo as this install reads it, and the one verb that applies it now (specs/client-packs FR-003). */
export function packRoutes(
  getPool: () => Pool | null,
  seams: PackSeams = production,
): ServerRoute[] {
  return [packReadRoute(getPool, seams), packSyncRoute(getPool, seams)];
}

function packReadRoute(
  getPool: () => Pool | null,
  seams: PackSeams,
): ServerRoute {
  return {
    method: "GET",
    path: "/api/pack",
    options: zodResponse(bearerScope("read"), PackSchema, {
      name: "Pack",
      description:
        "The client's pack repo this install reads and what its last sync did",
    }),
    handler: withPool(getPool, async (pool, _request, h) =>
      h.response(await packState(seams, pool)),
    ),
  };
}

async function packState(seams: PackSeams, pool: Pool) {
  const config = seams.config();

  return {
    configured: config !== null,
    repo: config?.repo ?? null,
    ref: config?.ref ?? null,
    sync: config ? await seams.readSync(pool) : null,
  };
}

function packSyncRoute(
  getPool: () => Pool | null,
  seams: PackSeams,
): ServerRoute {
  return {
    method: "POST",
    path: "/api/pack/sync",
    options: zodResponse(bearerScope("admin"), PackSyncResultSchema, {
      name: "PackSync",
      description:
        "Apply the pack repo's head now, under the lease one replica at a time holds",
    }),
    handler: withPool(getPool, async (pool, _request, h) =>
      h.response(await seams.sync(pool)),
    ),
  };
}
