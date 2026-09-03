import "server-only";
import { apiFetch } from "./client";
import type { ApiResult } from "./result";
import type { components } from "./schema";

// Implementation-loop repo surface (specs/implementation-loop FR10); types alias the generated schema, no hand-mirrored shapes.
export type ImplementationLoop = components["schemas"]["ImplementationLoop"];
export type LoopTicket = NonNullable<ImplementationLoop["current"]>;
export type ImplementationLoopToggle =
  components["schemas"]["ImplementationLoopToggle"];

const path = (repo: string) => `/api/repos/${repo}/implementation-loop`;

export function getImplementationLoop(
  repo: string,
): Promise<ApiResult<ImplementationLoop>> {
  return apiFetch("lore-api", path(repo));
}

export function setImplementationLoopEnabled(
  repo: string,
  enabled: boolean,
): Promise<ApiResult<ImplementationLoopToggle>> {
  return apiFetch("lore-api", path(repo), {
    method: "PUT",
    body: { enabled },
  });
}
