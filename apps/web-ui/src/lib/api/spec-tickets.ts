import "server-only";
import { apiFetch } from "./client";
import { withLimits, type SectionLimits } from "./loops";
import type { ApiResult } from "./result";
import type { components } from "./schema";

// The spec tickets loop in the shared loop sections; types alias the generated schema.
export type SpecTickets = components["schemas"]["SpecTickets"];
export type TicketsRow = SpecTickets["current"][number];

export function getSpecTickets(
  repo: string,
  limits?: SectionLimits,
): Promise<ApiResult<SpecTickets>> {
  return apiFetch(
    "lore-api",
    withLimits(`/api/repos/${repo}/spec-tickets`, limits),
  );
}
