// A person's session may read only the runs of the repositories GitHub showed at sign-in (ADR-053): the check the web tier's proxy made, now made where the run routes are.

import type { Request, ResponseToolkit, Server } from "@hapi/hapi";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import type { UserIdentity } from "./auth.js";
import { principalOf } from "./bearer-scope.js";
import { enforceRepoOpen, type RepoSource } from "./repo-guard.js";

/** Run routes declare their level with this source; `registerRunRepoGuard` resolves the run's repository, answers 404 when absent, and enforces that level. */
export const RUN_RECORD: RepoSource = { from: "record", find: () => null };

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
    const repo = await repoOf(runId);

    enforceTrue(repo !== null, apiError(404), "run not found");
    await enforceRepoOpen(request, repo);

    return h.continue;
  });
}

function namesRun(path: string): boolean {
  return RUN_ROUTES.some((prefix) => path.startsWith(prefix));
}

function personOf(request: Request): UserIdentity | null {
  return request.auth.isAuthenticated ? principalOf(request).user : null;
}
