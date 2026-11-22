// Reads the repository declaration a route carries; kept apart from the guard so bearer-scope can read it without an import cycle.

import type { Request } from "@hapi/hapi";
import type { RepoLevel } from "../../work/auth/repo-access.js";

export const ROUTE_KEY = "repoGuard";

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

/** Read the repository declaration stamped on a route by `repoLevel`, if any. */
export function repoDeclarationOf(request: {
  route: { settings: { app?: unknown } };
}): RepoDeclaration | undefined {
  const { settings } = request.route;
  const app = settings.app as
    Record<string, RepoDeclaration | undefined> | undefined;

  return app?.[ROUTE_KEY];
}
