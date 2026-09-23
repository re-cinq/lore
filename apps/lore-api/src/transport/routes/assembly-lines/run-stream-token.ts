// POST /api/assembly-runs/{id}/stream-token — the token a browser opens this run's channel of the live socket with (ADR-048). The web tier has already checked the person's session and repo access; lore-api only binds the token to this run.

import type { Request, ResponseToolkit, ServerRoute } from "@hapi/hapi";
import type { Pool } from "pg";
import { z } from "zod";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { PgAssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-pg.js";
import type { AssemblyRunsPort } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodResponse } from "../../http/zod-response.js";
import { zodValidate } from "../../http/zod-validate.js";
import { withPool } from "../with-pool.js";
import { mintLiveToken } from "../../../work/assembly-line-station/live-tokens.js";

const StreamTokenBody = z.object({
  user: z.object({ id: z.string().min(1), name: z.string().min(1) }),
});

export const RunStreamTokenSchema = z.object({
  token: z.string(),
  expires_at: z.date(),
});

const OPTIONS = zodResponse(
  {
    ...bearerScope("write"),
    validate: { payload: zodValidate(StreamTokenBody) },
  },
  RunStreamTokenSchema,
  {
    name: "RunStreamToken",
    description:
      "A short-lived token that opens this assembly run's channel of the live socket (/api/ws) as one person",
    errors: [404],
  },
);

/** Injectable for tests; production reads the run through the pool. */
export interface RunStreamTokenDeps {
  runs: Pick<AssemblyRunsPort, "getById">;
  mint: (
    runId: string,
    user: { id: string; name: string },
  ) => Promise<{ token: string; expiresAt: Date }>;
}

export function runStreamTokenRoute(
  getPool: () => Pool | null,
  injected?: RunStreamTokenDeps,
): ServerRoute {
  return {
    method: "POST",
    path: "/api/assembly-runs/{id}/stream-token",
    options: OPTIONS,
    handler: withPool(getPool, (pool, request, h) =>
      serveToken(injected ?? pgDeps(pool), request, h),
    ),
  };
}

function pgDeps(pool: Pool): RunStreamTokenDeps {
  return {
    runs: new PgAssemblyRuns(pool),
    mint: (runId, user) =>
      mintLiveToken(() => pool, { kind: "run", subject: runId, user }),
  };
}

async function serveToken(
  deps: RunStreamTokenDeps,
  request: Request,
  h: ResponseToolkit,
) {
  const runId = String(request.params.id);
  const run = await deps.runs.getById(runId);

  enforceTrue(run !== null, apiError(404), "assembly run not found");
  const { user } = request.payload as z.infer<typeof StreamTokenBody>;
  const minted = await deps.mint(runId, user);

  return h.response({ token: minted.token, expires_at: minted.expiresAt });
}
