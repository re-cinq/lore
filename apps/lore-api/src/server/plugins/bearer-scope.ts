import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
/** Bearer-token scope auth as a hapi scheme + strategy (ADR-033). */

import Boom from "@hapi/boom";
import { apiError } from "../api-error.js";
import type { Server, ServerAuthScheme, RouteOptions } from "@hapi/hapi";
import type { Pool } from "pg";
import { resolveTokenScopes, type TokenScope } from "../../api/routes/auth.js";

const STRATEGY = "bearer-scope";

/** Guard a native route with the bearer-scope strategy and a required scope. */
export function bearerScope(
  scope: TokenScope,
): Pick<RouteOptions, "auth" | "plugins"> {
  return { auth: STRATEGY, plugins: { [STRATEGY]: { scope } } };
}

// `apiError` owns the error envelope format to prevent drift between auth/zod/routes.
const denied = (statusCode: 401 | 403, error: string): Boom.Boom =>
  apiError(statusCode)(error);

const scheme =
  (getPool: () => Pool | null): ServerAuthScheme =>
  () => ({
    authenticate: async (request, h) => {
      const authHeader = request.headers.authorization;
      const bearer = (
        Array.isArray(authHeader) ? authHeader[0] : authHeader
      )?.replace("Bearer ", "");

      enforceTrue(bearer, (message) => denied(401, message), "unauthorized");

      const scopes = await resolveTokenScopes(getPool(), bearer);

      enforceTrue(
        scopes,
        (message) => denied(403, message),
        "insufficient scope",
      );

      const routeConfig = request.route.settings.plugins as Record<
        string,
        { scope?: TokenScope } | undefined
      >;
      const required = routeConfig[STRATEGY]?.scope;

      enforceTrue(
        !(required && !scopes.includes("admin") && !scopes.includes(required)),
        (message) => denied(403, message),
        "insufficient scope",
      );

      return h.authenticated({ credentials: { scope: scopes } });
    },
  });

export function registerBearerScope(
  server: Server,
  getPool: () => Pool | null,
): void {
  server.auth.scheme(STRATEGY, scheme(getPool));
  server.auth.strategy(STRATEGY, STRATEGY);
}
