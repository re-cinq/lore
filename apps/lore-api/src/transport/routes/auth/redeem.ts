// POST /api/auth/redeem — the web UI swaps the one-time code from the sign-in redirect for the person's session token. A code works once; the token lasts eight hours and carries the person and the repos they can open.

import type { ServerRoute } from "@hapi/hapi";
import type { z } from "zod";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import type { UserGrant } from "@re-cinq/lore-shared/models/login-handoff.js";
import { SESSION_TTL_MS } from "../../../work/auth/login-grant.js";
import {
  mintApiToken,
  type MintInput,
} from "../../../work/tokens/mint-token.js";
import { zodResponse } from "../../http/zod-response.js";
import { zodValidate } from "../../http/zod-validate.js";
import { withPool } from "../with-pool.js";
import type { AuthDeps } from "./auth-deps.js";
import { RedeemBody, RedeemSchema } from "./auth-schemas.js";

const OPTIONS = zodResponse(
  { auth: false as const, validate: { payload: zodValidate(RedeemBody) } },
  RedeemSchema,
  {
    name: "LoginRedeem",
    description: "A web session token for the person who just signed in",
    errors: [401],
  },
);

export function redeemRoute(deps: AuthDeps): ServerRoute {
  return {
    method: "POST",
    path: "/api/auth/redeem",
    options: OPTIONS,
    handler: withPool(deps.getPool, async (pool, request, h) => {
      const { code } = request.payload as z.infer<typeof RedeemBody>;
      const grant = (await deps.handoffs.take(code, "redeem"))?.grant;

      enforceTrue(grant, apiError(401), "invalid or used code");
      const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
      const { token } = await mintApiToken(
        pool,
        sessionToken(grant, expiresAt),
      );

      return h.response({
        token,
        expires_at: expiresAt,
        user: {
          login: grant.login,
          name: grant.name,
          avatar_url: grant.avatarUrl,
        },
      });
    }),
  };
}

function sessionToken(grant: UserGrant, expiresAt: Date): MintInput {
  return {
    name: `web-ui session ${grant.login}`,
    scopes: grant.scopes,
    createdBy: grant.login,
    expiresAt,
    kind: "user",
    user: {
      login: grant.login,
      displayName: grant.name,
      avatarUrl: grant.avatarUrl,
      repos: grant.repos,
    },
  };
}
