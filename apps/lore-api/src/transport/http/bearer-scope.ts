import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
/** Bearer-token scope auth as a hapi scheme + strategy (ADR-033). */

import Boom from "@hapi/boom";
import { apiError, rethrowBoom } from "@re-cinq/lore-shared/http/api-error.js";
import type {
  Server,
  ServerAuthScheme,
  RouteOptions,
  Request,
  ResponseToolkit,
} from "@hapi/hapi";
import type { Pool } from "pg";
import {
  resolvePrincipal,
  type CiIdentity,
  type Principal,
  type TokenScope,
  type UserIdentity,
} from "./auth.js";

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

async function authenticateBearer(
  request: Request,
  h: ResponseToolkit,
  pool: Pool | null,
) {
  const bearer = bearerOf(request);

  enforceTrue(bearer, (message) => denied(401, message), "unauthorized");

  const principal = await principalFor(request, pool, bearer);

  enforceTrue(principal, (message) => denied(401, message), "invalid token");

  enforceAuthorization(request, principal);

  return h.authenticated({ credentials: credentialsOf(principal) });
}

// A CI identity token is authorized by its route allowlist, not by a scope.
function enforceAuthorization(request: Request, principal: Principal): void {
  if (principal.ciIdentity) {
    enforceCiIdentityRoute(request, principal.ciIdentity);

    return;
  }
  enforceRouteScope(request, principal.scopes);
}

function credentialsOf(principal: Principal) {
  return {
    scope: principal.scopes,
    user: principal.user ?? undefined,
    app: {
      tokenHash: principal.tokenHash,
      ciIdentity: principal.ciIdentity ?? null,
    },
  };
}

// The routes a CI identity token or a repository's stored CI token may reach (a stored token has no ref, so FR-314 admits it on all of them): ingest only from the default branch (FR-156, FR-157), checks from any ref (FR-287); every other route is refused.
const CI_ROUTE_REFS: Partial<Record<string, "default" | "any">> = {
  "POST /api/repos/{owner}/{repo}/ingest": "default",
  "GET /api/repos/{owner}/{repo}/ingest-state": "default",
  "POST /api/ingest": "default",
  "POST /api/repos/{owner}/{repo}/impact": "any",
  "GET /api/repos/{owner}/{repo}/impact/base": "any",
  "POST /api/spec-links/parse": "any",
};

function enforceCiIdentityRoute(
  request: Request,
  ciIdentity: CiIdentity,
): void {
  const refs =
    CI_ROUTE_REFS[`${request.method.toUpperCase()} ${request.route.path}`];

  enforceTrue(
    refs === "any" ||
      (refs !== undefined && ciIdentity.stored === true) ||
      (refs === "default" &&
        ciIdentity.ref === `refs/heads/${ciIdentity.defaultBranch}`),
    (message) => denied(403, message),
    "identity token not allowed on this route",
  );
}

interface HeldApp {
  tokenHash: string | null;
  ciIdentity?: CiIdentity | null;
}

/** The principal an authenticated request carries; read it only in a route guarded by `bearerScope`. */
export function principalOf(request: Request): Principal {
  const { scope, user, app } = request.auth.credentials;
  const held = (app ?? { tokenHash: null }) as HeldApp;

  return {
    scopes: (scope ?? []) as TokenScope[],
    user: (user as UserIdentity | undefined) ?? null,
    tokenHash: held.tokenHash,
    ciIdentity: held.ciIdentity ?? null,
  };
}

async function principalFor(
  request: Request,
  pool: Pool | null,
  bearer: string,
): Promise<Principal | null> {
  try {
    return await resolvePrincipal(pool, bearer);
  } catch (err) {
    rethrowBoom(err);
    request.log(["error", "db"], err as Error);
    throw apiError(503)("database unavailable");
  }
}

// hapi types the header as string | string[]; only the first value can carry the credential.
function bearerOf(request: Request): string | undefined {
  const authHeader = request.headers.authorization;

  return (Array.isArray(authHeader) ? authHeader[0] : authHeader)?.replace(
    "Bearer ",
    "",
  );
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

// The scope a route stamped via `bearerScope`, read out of hapi's per-route plugin config.
function requiredScope(request: Request): TokenScope | undefined {
  const { settings } = request.route;
  const routeConfig = settings.plugins as Record<
    string,
    { scope?: TokenScope } | undefined
  >;

  return routeConfig[STRATEGY]?.scope;
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
