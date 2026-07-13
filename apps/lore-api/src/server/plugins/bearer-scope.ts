import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
/**
 * Bearer-token scope auth as a hapi scheme + strategy (ADR-033) — the
 * framework-native replacement for the legacy dispatcher's inline
 * `authorization?.replace("Bearer ", "")` + `validateClientToken` gate. It
 * authenticates the bearer once (via `resolveTokenScopes`), sets
 * `credentials.scope` to the token's scopes, and enforces the route's required
 * scope. Outcomes match the legacy gate byte-for-byte: a MISSING bearer → 401
 * `{ error: "unauthorized" }`; any present-but-invalid or under-scoped token →
 * 403 `{ error: "insufficient scope" }`. The LORE_INGEST_TOKEN full-access
 * fallback is preserved inside `resolveTokenScopes`.
 *
 * Routes opt in with `options: bearerScope("read")`; webhook routes (their own
 * HMAC verification) and `/healthz` set `auth: false`.
 */

import Boom from "@hapi/boom";
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

function denied(statusCode: 401 | 403, error: string): Boom.Boom {
  const boom = new Boom.Boom(error, { statusCode });

  // Replace Boom's { statusCode, error, message } envelope with the legacy
  // dispatcher's exact body so migrated routes stay byte-for-byte compatible.
  boom.output.payload = { error } as unknown as Boom.Payload;

  return boom;
}

const scheme =
  (getPool: () => Pool | null): ServerAuthScheme =>
  () => ({
    authenticate: async (request, h) => {
      const authHeader = request.headers.authorization;
      const bearer = (
        Array.isArray(authHeader) ? authHeader[0] : authHeader
      )?.replace("Bearer ", "");

      enforceTrue(bearer, denied(401, "unauthorized"));

      const scopes = await resolveTokenScopes(getPool(), bearer);

      enforceTrue(scopes, denied(403, "insufficient scope"));

      const routeConfig = request.route.settings.plugins as Record<
        string,
        { scope?: TokenScope } | undefined
      >;
      const required = routeConfig[STRATEGY]?.scope;

      enforceTrue(
        !(required && !scopes.includes("admin") && !scopes.includes(required)),
        denied(403, "insufficient scope"),
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
