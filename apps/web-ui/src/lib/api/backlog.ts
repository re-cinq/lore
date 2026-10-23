import "server-only";
import { apiFetch } from "./client";
import type { ApiResult } from "./result";
import type { components } from "./schema";

// Implementation-loop repo surface (specs/implementation-loop FR10); types alias the generated schema, no hand-mirrored shapes.
export type ImplementationLoop = components["schemas"]["ImplementationLoop"];
export type LoopTicket = ImplementationLoop["next"][number];

export function getImplementationLoop(
  repo: string,
): Promise<ApiResult<ImplementationLoop>> {
  return apiFetch("lore-api", `/api/repos/${repo}/implementation-loop`);
}
