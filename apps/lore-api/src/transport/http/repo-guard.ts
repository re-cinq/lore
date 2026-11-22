// A person's session may reach a repository's routes only when they can open the repository (ADR-053). One guard for every route that names the repository in its path, so a route added later is covered without asking.

import type {
  Request,
  ResponseToolkit,
  RouteOptions,
  Server,
} from "@hapi/hapi";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import {
  SIGN_IN_LIST_ONLY,
  type RepoAccess,
  type RepoLevel,
} from "../../work/auth/repo-access.js";
import { principalOf } from "./bearer-scope.js";
import {
  ROUTE_KEY,
  repoDeclarationOf,
  type RepoDeclaration,
  type RepoSource,
} from "./repo-declaration.js";

const KEY = "repoAccess";

export type { RepoLevel };
export { repoDeclarationOf };
export type { RepoDeclaration, RepoSource };

/** Declared in place of a way to find one repository, by a route whose answer can hold rows of several (FR-259). */
export const SPANS_REPOS: RepoSource = { from: "spans" };

/** Declare a route's required repository level and how its repository is found, beside `bearerScope` (FR-001, FR-257, FR-259). */
export function repoLevel(
  level: RepoLevel,
  source: RepoSource = { from: "path" },
): Pick<RouteOptions, "app"> {
  return { app: { [ROUTE_KEY]: { level, source } satisfies RepoDeclaration } };
}

/** The repositories a person may read on a route that spans them: their sign-in list. Null for a service token, which reads every row (FR-260). */
export function readableReposOf(request: Request): string[] | null {
  return principalOf(request).user?.repos ?? null;
}

/** Service tokens, anonymous routes and routes that name no repository pass untouched. */
export function registerRepoGuard(server: Server, access: RepoAccess): void {
  (server.app as Record<string, unknown>)[KEY] = access;
  server.ext("onPreHandler", async (request: Request, h: ResponseToolkit) => {
    const ci = ciIdentityOf(request);
    const repo = isPerson(request) || ci ? await repoNamedBy(request) : null;

    if (repo) {
      await enforceRepoReachable(request, repo, ci);
    }

    return h.continue;
  });
}

/** For a route that names a repository: refuses a person whose GitHub permission is below the route's declared level (default `read`) with 403 (FR-007). */
export async function enforceRepoOpen(
  request: Request,
  repo: string,
  level: RepoLevel = repoDeclarationOf(request)?.level ?? "read",
): Promise<void> {
  if (!request.auth.isAuthenticated) {
    return;
  }
  enforceTrue(
    await repoAccessOf(request).canOpen(principalOf(request), repo, level),
    apiError(403),
    "repository not allowed",
  );
}

/** The server's repo access; a server built without the guard answers from the sign-in list alone. */
export function repoAccessOf(request: Request): RepoAccess {
  const held = (request.server.app as Record<string, unknown>)[KEY];

  return (held as RepoAccess | undefined) ?? SIGN_IN_LIST_ONLY;
}

async function enforceRepoReachable(
  request: Request,
  repo: string,
  ci: { repository: string } | null,
): Promise<void> {
  if (!ci) {
    await enforceRepoOpen(request, repo);

    return;
  }
  enforceTrue(
    repo.toLowerCase() === ci.repository.toLowerCase(),
    apiError(403),
    "repository not allowed",
  );
}

/** The verified CI run behind an authenticated request, which may reach only its own repository (FR-313). */
function ciIdentityOf(request: Request) {
  return request.auth.isAuthenticated
    ? (principalOf(request).ciIdentity ?? null)
    : null;
}

/** Only a person's session is checked against a repository, so a service token's route never pays for finding it. */
function isPerson(request: Request): boolean {
  return request.auth.isAuthenticated && principalOf(request).user !== null;
}

/** Where a request carries the name of its repository: its `{owner}/{repo}` path parameters, or a query or payload field. */
export type RepoLocation =
  { from: "path" } | { from: "query" | "payload"; name: string };

/** Where a route's repository name sits: as the route declared it, else its path parameters. Null for a record or a route spanning repositories. */
export function repoLocationOf(request: {
  route: { settings: { app?: unknown } };
}): RepoLocation | null {
  const source = repoDeclarationOf(request)?.source ?? { from: "path" };

  return source.from === "record" || source.from === "spans" ? null : source;
}

/** The repository name a request carries at a location, if it holds one. */
export function repoAt(
  request: Request,
  location: RepoLocation,
): string | null {
  return location.from === "path"
    ? pathRepo(request)
    : fieldNamed(request, location);
}

/** The repository a request concerns: where the route declared it, else its `{owner}/{repo}` path parameters. */
async function repoNamedBy(request: Request): Promise<string | null> {
  const declared = repoDeclarationOf(request);

  if (declared?.source.from === "record") {
    return declared.source.find(request);
  }
  const location = repoLocationOf(request);

  return location ? repoAt(request, location) : null;
}

function pathRepo(request: Request): string | null {
  const { owner, repo } = request.params as { owner?: string; repo?: string };

  return owner && repo ? `${owner}/${repo}` : null;
}

function fieldNamed(
  request: Request,
  source: { from: "query" | "payload"; name: string },
): string | null {
  const holder = source.from === "query" ? request.query : request.payload;
  const named = (holder as Record<string, unknown> | null)?.[source.name];

  return typeof named === "string" && named ? named : null;
}
