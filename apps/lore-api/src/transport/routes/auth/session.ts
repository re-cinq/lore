// What the web UI asks lore-api about the person behind its session token: who they are, whether they can open a repo, and ending the session.

import type { ServerRoute } from "@hapi/hapi";
import type { Pool } from "pg";
import type { z } from "zod";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { repoAllowed } from "../../../work/auth/login-grant.js";
import { revokeTokenByHash } from "../../../work/tokens/mint-token.js";
import { bearerScope, principalOf } from "../../http/bearer-scope.js";
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
    handler: (request) => {
      const { user, scopes } = principalOf(request);

      enforceTrue(user, apiError(403), "not a user session");

      return {
        login: user.login,
        name: user.name,
        avatar_url: user.avatarUrl,
        scopes,
      };
    },
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
    handler: (request) => {
      const { repo } = request.query as z.infer<typeof AccessQuery>;

      return { allowed: repoAllowed(principalOf(request), repo) };
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
      const { tokenHash } = principalOf(request);

      enforceTrue(tokenHash, apiError(400), "no session to end");
      await revokeTokenByHash(pool, tokenHash);

      return h.response({ ok: true });
    }),
  };
}
