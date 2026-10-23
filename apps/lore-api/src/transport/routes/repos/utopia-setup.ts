import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import {
  utopiaClientFrom,
  utopiaConfigured,
} from "@re-cinq/lore-shared/utopia/utopia-client.js";
import type { Pool } from "pg";
import type {
  Request,
  ResponseObject,
  ResponseToolkit,
  ServerRoute,
} from "@hapi/hapi";
import { z } from "zod";
import { zodResponse } from "../../http/zod-response.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodValidate } from "../../http/zod-validate.js";
import { withPool } from "../with-pool.js";
import {
  setUpRepoInUtopia,
  storeUtopiaSetup,
} from "../../../work/utopia/utopia-setup.js";

const UtopiaSetupBody = z.object({
  /** A person's Utopia session JWT; used for this call and never stored. */
  session_token: z.string().min(1),
  workspace_id: z.string().min(1),
});

type UtopiaSetupBody = z.infer<typeof UtopiaSetupBody>;

const UtopiaSetupResultSchema = z.object({
  kb_id: z.string(),
  ontology_version: z.number(),
});

/** POST /api/repos/{owner}/{repo}/utopia/setup — the repo's Utopia knowledge base and ontology, recorded in its settings (specs/utopia-graph-mirror). */
export function utopiaSetupRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "POST",
    path: "/api/repos/{owner}/{repo}/utopia/setup",
    options: zodResponse(
      {
        ...bearerScope("admin"),
        validate: { payload: zodValidate(UtopiaSetupBody) },
      },
      UtopiaSetupResultSchema,
      {
        name: "UtopiaSetupResult",
        description:
          "The repo's Utopia knowledge base and the ontology version it holds, now in its settings",
        errors: [400, 404],
      },
    ),
    handler: withPool(getPool, serveUtopiaSetup),
  };
}

async function serveUtopiaSetup(
  pool: Pool,
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const repo = `${request.params.owner}/${request.params.repo}`;
  const body = request.payload as UtopiaSetupBody;
  const session = configuredUtopia().withCredential(body.session_token);

  await enforceRepoHeld(pool, repo);
  const settings = await setUpRepoInUtopia(session, {
    repo,
    workspaceId: body.workspace_id,
  });

  await storeUtopiaSetup(pool, repo, settings);

  return h.response(settings);
}

function configuredUtopia() {
  enforceUtopiaConfigured();

  return utopiaClientFrom(process.env);
}

export function enforceUtopiaConfigured(): void {
  enforceTrue(
    utopiaConfigured(),
    apiError(503),
    "no Utopia configured — UTOPIA_API_URL is unset on this deployment",
  );
}

export async function enforceRepoHeld(pool: Pool, repo: string): Promise<void> {
  const { rows } = await pool.query(
    "SELECT full_name FROM lore.repos WHERE full_name = $1",
    [repo],
  );

  enforceTrue(rows.length !== 0, apiError(404), "Repo not found");
}
