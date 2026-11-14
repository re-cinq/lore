// A person's session may read only the runs of the repositories GitHub showed at sign-in (ADR-053): the check the web tier's proxy made, now made where the run routes are.

import type { Request, ResponseToolkit, Server } from "@hapi/hapi";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { repoAllowed } from "../../work/auth/login-grant.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import type { UserIdentity } from "./auth.js";
import { principalOf } from "./bearer-scope.js";

/** The run routes and their older spelling, which serves the same reads. */
const RUN_ROUTES = ["/api/assembly-runs/", "/api/assembly-lines/"];

export type RunRepoOf = (runId: string) => Promise<string | null>;

/** Service tokens, and a route that names no run (the list), pass untouched. */
export function registerRunRepoGuard(server: Server, repoOf: RunRepoOf): void {
  server.ext("onPreHandler", async (request: Request, h: ResponseToolkit) => {
    const user = personOf(request);
    const runId = request.params.id;

    if (!user || !runId || !namesRun(request.path)) {
      return h.continue;
    }
    enforceReadable(user, await repoOf(runId));

    return h.continue;
  });
}

function namesRun(path: string): boolean {
  return RUN_ROUTES.some((prefix) => path.startsWith(prefix));
}

function personOf(request: Request): UserIdentity | null {
  return request.auth.isAuthenticated ? principalOf(request).user : null;
}

function enforceReadable(user: UserIdentity, repo: string | null): void {
  enforceTrue(repo !== null, apiError(404), "run not found");
  enforceTrue(
    repoAllowed({ user }, repo),
    apiError(403),
    "repository not allowed",
  );
}
