import type { Request } from "@hapi/hapi";
import type { Pool } from "pg";
import { getPool } from "@re-cinq/lore-server-core/platform/db.js";
import { personGithubEnv } from "../../work/auth/person-github-env.js";
import { principalOf } from "./bearer-scope.js";

/** A person's session acts on GitHub with that person's token, never the App's (FR-290); any other caller leaves the App acting (FR-297, FR-337). */
export async function actingEnv(
  request: Request,
  pool?: Pool,
): Promise<NodeJS.ProcessEnv | undefined> {
  const { user, tokenHash } = principalOf(request);

  return user === null
    ? undefined
    : personGithubEnv(pool ?? getPool(), { person: true, tokenHash });
}
