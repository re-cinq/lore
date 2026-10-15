import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import type { UtopiaMirrorSettings } from "@re-cinq/lore-shared/models/repo-settings.js";
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
  type UtopiaSetup,
} from "../../../work/utopia/utopia-setup.js";
import {
  saveUtopiaSource,
  utopiaSourceFor,
} from "../../../outbound/utopia-sources.js";

const UtopiaSetupBody = z.object({
  /** A person's Utopia session JWT; used for this call and never stored. */
  session_token: z.string().min(1),
  workspace_id: z.string().min(1),
});

type UtopiaSetupBody = z.infer<typeof UtopiaSetupBody>;

const UtopiaSetupResultSchema = z.object({
  kb_id: z.string(),
  source_id: z.string(),
  ontology_version: z.number(),
});

/** POST /api/repos/{owner}/{repo}/utopia/setup — the repo's Utopia knowledge base, ontology and push source, recorded in its settings (specs/utopia-graph-mirror). */
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
          "The repo's Utopia knowledge base and push source, now in its settings; the source key itself is never answered",
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
  const session = configuredUtopia().withSession(body.session_token);

  await enforceRepoHeld(pool, repo);
  const setup = await setUpRepoInUtopia(session, {
    repo,
    workspaceId: body.workspace_id,
    existing: await utopiaSourceFor(pool, repo),
  });

  await storeSetup(pool, repo, setup);

  return h.response(setup.settings);
}

/** The key first, to lore.utopia_sources, then the ids to settings: settings never name a source whose key is not stored. */
async function storeSetup(
  pool: Pool,
  repo: string,
  { settings, source }: UtopiaSetup,
): Promise<void> {
  await saveUtopiaSource(pool, {
    repo,
    kbId: source.kbId,
    sourceId: source.id,
    key: source.key,
  });
  await storeMirrorSettings(pool, repo, settings);
}

function configuredUtopia() {
  enforceTrue(
    utopiaConfigured(),
    apiError(503),
    "no Utopia configured — UTOPIA_API_URL is unset on this deployment",
  );

  return utopiaClientFrom(process.env);
}

async function enforceRepoHeld(pool: Pool, repo: string): Promise<void> {
  const { rows } = await pool.query(
    "SELECT full_name FROM lore.repos WHERE full_name = $1",
    [repo],
  );

  enforceTrue(rows.length !== 0, apiError(404), "Repo not found");
}

/** Merged, not replaced: the settings block carries everything else the repo was configured with. */
async function storeMirrorSettings(
  pool: Pool,
  repo: string,
  utopia: UtopiaMirrorSettings,
): Promise<void> {
  await pool.query(
    `UPDATE lore.repos SET settings = COALESCE(settings, '{}') || $1::jsonb WHERE full_name = $2`,
    [JSON.stringify({ utopia }), repo],
  );
}
