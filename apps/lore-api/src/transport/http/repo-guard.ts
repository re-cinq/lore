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
} from "../../work/auth/repo-access.js";
import { principalOf } from "./bearer-scope.js";

const KEY = "repoAccess";
const ROUTE_KEY = "repoGuard";

/** GitHub's permission level on a repository (FR-001). */
export type RepoLevel = "read" | "write" | "admin";

/** How a route finds the repository it concerns (FR-257), or that its answer spans several (FR-259). */
export type RepoSource =
  | { from: "path" }
  | { from: "query" | "payload"; name: string }
  | {
      from: "record";
      find: (request: Request) => Promise<string | null> | string | null;
    }
  | { from: "spans" };

/** The repository level and lookup rule stamped onto a route's options. */
export interface RepoDeclaration {
  level: RepoLevel;
  source: RepoSource;
}

/** Declared in place of a way to find one repository, by a route whose answer can hold rows of several (FR-259). */
export const SPANS_REPOS: RepoSource = { from: "spans" };

/** Declare a route's required repository level and how its repository is found, beside `bearerScope` (FR-001, FR-257, FR-259). */
export function repoLevel(
  level: RepoLevel,
  source: RepoSource = { from: "path" },
): Pick<RouteOptions, "app"> {
  return { app: { [ROUTE_KEY]: { level, source } satisfies RepoDeclaration } };
}

/** Read the repository declaration stamped on a route by {@link repoLevel}, if any. */
export function repoDeclarationOf(request: {
  route: { settings: { app?: unknown } };
}): RepoDeclaration | undefined {
  const { settings } = request.route;
  const app = settings.app as
    Record<string, RepoDeclaration | undefined> | undefined;

  return app?.[ROUTE_KEY];
}

/** The repositories a person may read on a route that spans them: their sign-in list. Null for a service token, which reads every row (FR-260). */
export function readableReposOf(request: Request): string[] | null {
  return principalOf(request).user?.repos ?? null;
}

/** Service tokens, anonymous routes and routes that name no repository pass untouched. */
export function registerRepoGuard(server: Server, access: RepoAccess): void {
  (server.app as Record<string, unknown>)[KEY] = access;
  server.ext("onPreHandler", async (request: Request, h: ResponseToolkit) => {
    const repo = isPerson(request) ? await repoNamedBy(request) : null;

    if (repo) {
      await enforceRepoOpen(request, repo);
    }

    return h.continue;
  });
}

/** For a route that names the repository somewhere the guard cannot see: a body or a query. Refuses a person who cannot open it with 403. */
export async function enforceRepoOpen(
  request: Request,
  repo: string,
): Promise<void> {
  if (!request.auth.isAuthenticated) {
    return;
  }
  enforceTrue(
    await repoAccessOf(request).canOpen(principalOf(request), repo),
    apiError(403),
    "repository not allowed",
  );
}

/** The server's repo access; a server built without the guard answers from the sign-in list alone. */
export function repoAccessOf(request: Request): RepoAccess {
  const held = (request.server.app as Record<string, unknown>)[KEY];

  return (held as RepoAccess | undefined) ?? SIGN_IN_LIST_ONLY;
}

/** Only a person's session is checked against a repository, so a service token's route never pays for finding it. */
function isPerson(request: Request): boolean {
  return request.auth.isAuthenticated && principalOf(request).user !== null;
}

/** The repository a request concerns: where the route declared it, else its `{owner}/{repo}` path parameters. */
async function repoNamedBy(request: Request): Promise<string | null> {
  const declared = repoDeclarationOf(request);

  return declared ? declaredRepo(request, declared.source) : pathRepo(request);
}

function pathRepo(request: Request): string | null {
  const { owner, repo } = request.params as { owner?: string; repo?: string };

  return owner && repo ? `${owner}/${repo}` : null;
}

function declaredRepo(
  request: Request,
  source: RepoSource,
): Promise<string | null> | string | null {
  if (source.from === "spans") {
    return null;
  }

  if (source.from === "path") {
    return pathRepo(request);
  }

  return source.from === "record"
    ? source.find(request)
    : fieldNamed(request, source);
}

function fieldNamed(
  request: Request,
  source: { from: "query" | "payload"; name: string },
): string | null {
  const holder = source.from === "query" ? request.query : request.payload;
  const named = (holder as Record<string, unknown> | null)?.[source.name];

  return typeof named === "string" && named ? named : null;
}
