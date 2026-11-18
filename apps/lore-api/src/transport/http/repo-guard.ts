// A person's session may reach a repository's routes only when they can open the repository (ADR-053). One guard for every route that names the repository in its path, so a route added later is covered without asking.

import type { Request, ResponseToolkit, Server } from "@hapi/hapi";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import {
  SIGN_IN_LIST_ONLY,
  type RepoAccess,
} from "../../work/auth/repo-access.js";
import { principalOf } from "./bearer-scope.js";

const KEY = "repoAccess";

/** Service tokens, anonymous routes and routes that name no repository pass untouched. */
export function registerRepoGuard(server: Server, access: RepoAccess): void {
  (server.app as Record<string, unknown>)[KEY] = access;
  server.ext("onPreHandler", async (request: Request, h: ResponseToolkit) => {
    const repo = repoNamedBy(request);

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

function repoNamedBy(request: Request): string | null {
  const { owner, repo } = request.params as { owner?: string; repo?: string };

  return owner && repo ? `${owner}/${repo}` : null;
}
