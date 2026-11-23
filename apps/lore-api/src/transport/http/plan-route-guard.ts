// The routes under /api/plans name a plan, not a repository, so the repository guard cannot see them. This guard finds the plan's repository and asks the guard's own question (FR-488, FR-489).
import type { Lifecycle, Request, Server } from "@hapi/hapi";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import type { Principal, TokenScope } from "./auth.js";
import { principalOfCredentials } from "./bearer-scope.js";
import { repoAccessOf } from "./repo-guard.js";

export const PLANS_PREFIX = "/api/plans";

/** The repository a plan belongs to, or null when there is no such plan. */
export type PlanRepoOf = (planId: string) => Promise<string | null>;

/** Authenticates every route under /api/plans with a bearer token. A person on a plan of a repository is held to what GitHub lets them do there, whatever scope their session carries (FR-035); anyone else reads with any token and changes with `write` or `admin`. */
export function planRouteGuard(
  server: Server,
  repoOf: PlanRepoOf,
): Lifecycle.Method {
  return async (request, h) => {
    if (!request.path.startsWith(PLANS_PREFIX)) {
      return h.continue;
    }
    const { credentials } = await server.auth.test("bearer-scope", request);
    const principal = principalOfCredentials(credentials);

    carryPrincipal(request, credentials);
    const repo = principal.user ? await planRepoNamed(request, repoOf) : null;

    if (repo === null) {
      enforceScope(request, principal.scopes);

      return h.continue;
    }
    await enforceRepoOpen(request, principal, repo);

    return h.continue;
  };
}

/** hapi leaves `request.auth` empty on a route without auth of its own; set it the way hapi does, so the handler serves the person (FR-290, FR-311) and `principalOf` reads them. */
function carryPrincipal(
  request: Request,
  credentials: Request["auth"]["credentials"],
): void {
  Object.assign(request.auth, {
    isAuthenticated: true,
    strategy: "bearer-scope",
    credentials,
  });
}

function enforceScope(request: Request, scopes: TokenScope[]): void {
  enforceTrue(
    isRead(request) || mayChange(scopes),
    apiError(403),
    "insufficient scope",
  );
}

async function enforceRepoOpen(
  request: Request,
  principal: Principal,
  repo: string,
): Promise<void> {
  enforceTrue(
    await repoAccessOf(request).canOpen(
      principal,
      repo,
      isRead(request) ? "read" : "write",
    ),
    apiError(403),
    "repository not allowed",
  );
}

/** The repository of the plan the path names, refused with 404 when there is no such plan, or the one a new plan names; null when the request names none. */
async function planRepoNamed(
  request: Request,
  repoOf: PlanRepoOf,
): Promise<string | null> {
  const planId = planIdOf(request);

  if (!planId) {
    return newPlanRepoOf(request);
  }
  const repo = await repoOf(planId);

  enforceTrue(repo !== null, apiError(404), "plan not found");

  return repo;
}

/** The planning library names the plan `{planId}`, Lore's own plan routes `{id}`. */
function planIdOf(request: Request): string | null {
  const { planId, id } = request.params as { planId?: string; id?: string };

  return planId || id || null;
}

/** A new plan names its repository in its payload; anything else leaves the payload check to the route. */
function newPlanRepoOf(request: Request): string | null {
  const repo = (request.payload as { repo?: unknown } | null)?.repo;

  return typeof repo === "string" && repo ? repo : null;
}

/** hapi answers a HEAD through the GET route and keeps the method as `head`. */
function isRead(request: Request): boolean {
  return request.method === "get" || request.method === "head";
}

function mayChange(scopes: TokenScope[]): boolean {
  return scopes.includes("write") || scopes.includes("admin");
}
