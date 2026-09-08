import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
/** Bearer-token scope auth as a hapi scheme + strategy (ADR-033). */

import Boom from "@hapi/boom";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import type {
  Server,
  ServerAuthScheme,
  RouteOptions,
  Request,
  ResponseToolkit,
} from "@hapi/hapi";
import type { Pool } from "pg";
import { resolveTokenScopes, type TokenScope } from "./auth.js";

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

// hapi types the header as string | string[]; only the first value can carry the credential.
function bearerOf(request: Request): string | undefined {
  const authHeader = request.headers.authorization;

  return (Array.isArray(authHeader) ? authHeader[0] : authHeader)?.replace(
    "Bearer ",
    "",
  );
}

// The scope a route stamped via `bearerScope`, read out of hapi's per-route plugin config.
function requiredScope(request: Request): TokenScope | undefined {
  const { settings } = request.route;
  const routeConfig = settings.plugins as Record<
    string,
    { scope?: TokenScope } | undefined
  >;

  return routeConfig[STRATEGY]?.scope;
}

// A route that stamps no scope via `bearerScope` accepts any valid token; `admin` satisfies every scope.
function enforceRouteScope(request: Request, scopes: TokenScope[]): void {
  const required = requiredScope(request);

  enforceTrue(
    !(required && !scopes.includes("admin") && !scopes.includes(required)),
    (message) => denied(403, message),
    "insufficient scope",
  );
}

async function authenticateBearer(
  request: Request,
  h: ResponseToolkit,
  pool: Pool | null,
) {
  const bearer = bearerOf(request);

  enforceTrue(bearer, (message) => denied(401, message), "unauthorized");

  const scopes = await resolveTokenScopes(pool, bearer);

  enforceTrue(scopes, (message) => denied(403, message), "insufficient scope");
  enforceRouteScope(request, scopes);

  return h.authenticated({ credentials: { scope: scopes } });
}

const scheme =
  (getPool: () => Pool | null): ServerAuthScheme =>
  () => ({
    authenticate: (request, h) => authenticateBearer(request, h, getPool()),
  });

export function registerBearerScope(
  server: Server,
  getPool: () => Pool | null,
): void {
  server.auth.scheme(STRATEGY, scheme(getPool));
  server.auth.strategy(STRATEGY, STRATEGY);
}
