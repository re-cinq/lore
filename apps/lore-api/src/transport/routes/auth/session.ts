// What the web UI asks lore-api about the person behind its session token: who they are, whether they can open a repo, and ending the session.

import type { Request, ServerRoute } from "@hapi/hapi";
import type { Pool } from "pg";
import type { z } from "zod";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { announceSessionEnded } from "../../../work/auth/session-ended.js";
import { signOutSession } from "../../../work/auth/user-token-refresh.js";
import { revokeTokenByHash } from "../../../work/tokens/mint-token.js";
import { bearerScope, principalOf } from "../../http/bearer-scope.js";
import { repoAccessOf } from "../../http/repo-guard.js";
import { OkSchema } from "../../http/ok-schema.js";
import { zodResponse } from "../../http/zod-response.js";
import { zodValidate } from "../../http/zod-validate.js";
import { withPool } from "../with-pool.js";
import { AccessQuery, AccessSchema, MeSchema } from "./auth-schemas.js";

export function meRoute(): ServerRoute {
  return {
    method: "GET",
    path: "/api/auth/me",
    options: zodResponse(bearerScope("read"), MeSchema, {
      name: "AuthMe",
      description: "The person behind a web session token",
      errors: [403],
    }),
    handler: (request) => whoAmI(request),
  };
}

function whoAmI(request: Request) {
  const { user, scopes } = principalOf(request);

  enforceTrue(user, apiError(403), "not a user session");

  return {
    login: user.login,
    name: user.name,
    avatar_url: user.avatarUrl,
    scopes,
    started_at: user.startedAt,
    expires_at: user.expiresAt,
  };
}

export function accessRoute(): ServerRoute {
  return {
    method: "GET",
    path: "/api/auth/access",
    options: zodResponse(
      { ...bearerScope("read"), validate: { query: zodValidate(AccessQuery) } },
      AccessSchema,
      {
        name: "AuthAccess",
        description: "Whether the token's person can open a repository",
        errors: [400],
      },
    ),
    handler: async (request) => {
      const { repo } = request.query as z.infer<typeof AccessQuery>;
      const access = repoAccessOf(request);

      return { allowed: await access.canOpen(principalOf(request), repo) };
    },
  };
}

export function logoutRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "POST",
    path: "/api/auth/logout",
    options: zodResponse(bearerScope("read"), OkSchema, {
      name: "AuthLogout",
      description: "Ends the web session: its token stops working at once",
      errors: [400],
    }),
    handler: withPool(getPool, async (pool, request, h) => {
      const { tokenHash, user } = principalOf(request);

      enforceTrue(tokenHash, apiError(400), "no session to end");

      await endSessionTokens(pool, tokenHash, user?.sessionId);

      if (user?.sessionId) {
        announceSessionEnded(user.sessionId);
      }

      return h.response({ ok: true });
    }),
  };
}

async function endSessionTokens(
  pool: Pool,
  tokenHash: string,
  sessionId: string | undefined,
): Promise<void> {
  if (!sessionId) {
    return revokeTokenByHash(pool, tokenHash);
  }

  return signOutSession(pool, sessionId, tokenHash);
}
