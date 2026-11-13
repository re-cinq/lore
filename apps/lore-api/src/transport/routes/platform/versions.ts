import { z } from "zod";
import type { Pool } from "pg";
import type {
  Request,
  ResponseObject,
  ResponseToolkit,
  ServerRoute,
} from "@hapi/hapi";
import { PgServiceVersions } from "@re-cinq/lore-shared/project/service-versions/service-versions-pg.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { OkSchema } from "../../http/ok-schema.js";
import { zodResponse } from "../../http/zod-response.js";
import { zodValidate } from "../../http/zod-validate.js";
import { withPool } from "../with-pool.js";
import {
  versionsAnswer,
  VersionsSchema,
  type VersionSources,
} from "../../../work/versions/versions-answer.js";
import { productionVersionSources } from "../../../work/versions/version-sources.js";

export function versionsRoute(
  getPool: () => Pool | null,
  sourcesOf: (pool: Pool | null) => VersionSources = productionVersionSources,
): ServerRoute {
  return {
    method: "GET",
    path: "/api/versions",
    options: zodResponse(bearerScope("read"), VersionsSchema, {
      name: "Versions",
      description:
        "The build every Lore service runs, the floor and its clusters, the database schema, what is on the floor and the agent image; a source that fails answers its own error",
    }),
    handler: async (_request, h) =>
      h.response(await versionsAnswer(sourcesOf(getPool()))),
  };
}

// Only the lore-mcp gateway reports through this route: lore-api and stations write their own rows on their pools.
const ServiceVersionBody = z.object({
  service: z.literal("lore-mcp"),
  build: z.string().min(1),
  packages: z.record(z.string(), z.string()),
});

export function serviceVersionsRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "POST",
    path: "/api/service-versions",
    options: zodResponse(
      {
        ...bearerScope("write"),
        validate: { payload: zodValidate(ServiceVersionBody) },
      },
      OkSchema,
      {
        name: "ServiceVersionRecorded",
        description: "The lore-mcp gateway's start was recorded",
      },
    ),
    handler: withPool(getPool, recordServiceVersion),
  };
}

async function recordServiceVersion(
  pool: Pool,
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const body = request.payload as z.infer<typeof ServiceVersionBody>;

  await new PgServiceVersions(pool).record({ ...body, startedAt: new Date() });

  return h.response({ ok: true }).code(200);
}
