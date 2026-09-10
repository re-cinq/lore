import type {
  Request,
  ResponseObject,
  ResponseToolkit,
  ServerRoute,
} from "@hapi/hapi";
import type { Pool } from "pg";
import { z } from "zod";
import { toRow } from "@re-cinq/lore-shared/lib/row.js";
import { GITHUB_INSTALLATION_COLUMNS } from "@re-cinq/lore-shared/models/github-installation.js";
import { PgGithubInstallations } from "@re-cinq/lore-shared/project/github-installations/github-installations-pg.js";
import type { GithubInstallationsRepository } from "@re-cinq/lore-shared/project/github-installations/github-installations-port.js";
import { zodResponse } from "../../http/zod-response.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { withPool } from "../with-pool.js";
import { GithubInstallationWire } from "./record-installation.js";

/** The accounts Lore is connected to (specs/4-ux-repo-onboarding FR-8), each in its wire shape, ordered by account login — what the Connect GitHub page shows. */
export async function handleListInstallations(deps: {
  installations: GithubInstallationsRepository;
}): Promise<{ code: 200; body: z.infer<typeof GithubInstallationWire>[] }> {
  const installations = await deps.installations.list();

  return {
    code: 200,
    body: installations.map((installation) =>
      GithubInstallationWire.parse(
        toRow(GITHUB_INSTALLATION_COLUMNS, installation),
      ),
    ),
  };
}

const LIST_INSTALLATIONS_OPTIONS = zodResponse(
  { ...bearerScope("read") },
  z.array(GithubInstallationWire),
  {
    name: "GithubInstallations",
    description: "Every connected GitHub account, ordered by account login",
  },
);

/** GET /api/github/installations — the connected accounts the Connect GitHub page lists. Read scope: an org's login is not a secret. */
export function githubInstallationsListRoute(
  getPool: () => Pool | null,
): ServerRoute {
  return {
    method: "GET",
    path: "/api/github/installations",
    options: LIST_INSTALLATIONS_OPTIONS,
    handler: withPool(getPool, serveListInstallations),
  };
}

async function serveListInstallations(
  pool: Pool,
  _request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const result = await handleListInstallations({
    installations: new PgGithubInstallations(pool),
  });

  return h.response(result.body).code(result.code);
}
