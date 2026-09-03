/** Domain-route OpenAPI sidecar (ADR-035 fork 3): schemas for hand-validated routes + wildcard verb table. */

import type { ZodType } from "zod";
import { AgentInputSchema } from "../features/agents/agents-schema.js";
import { DarkFactorySettingsSchema } from "../features/dark-factory/dark-factory-settings.js";

/** Concrete verbs for method:"*" routes (currently empty: split routes to per-verb + 405 fallback). */
export const WILDCARD_METHODS: Record<string, string[]> = {};

/** Paths where wildcard route exists ONLY to answer 405; undeclaredWildcards() fails if not listed. */
export const METHOD_NOT_ALLOWED_FALLBACKS: string[] = [
  "/api/tokens",
  "/api/repos/{owner}/{repo}/settings/dark-factory",
];

/** How a domain-validated write route's request body is documented. */
export type DomainBody =
  | { schema: ZodType; freeform?: false }
  | { schema?: undefined; freeform: true };

/** Request body for domain-validated write route: schema lifts zod, freeform marks uncovered. */
export const DOMAIN_BODIES: Record<string, DomainBody> = {
  // agents — the domain validator IS a zod schema (agents-schema.ts).
  "POST /api/repos/{owner}/{repo}/agent-definitions": {
    schema: AgentInputSchema,
  },
  "PUT /api/repos/{owner}/{repo}/agent-definitions/{name}": {
    schema: AgentInputSchema,
  },
  "PUT /api/agent-definitions/{name}": {
    schema: AgentInputSchema,
  },

  // dark-factory — likewise (dark-factory-settings.ts).
  "PUT /api/repos/{owner}/{repo}/settings/dark-factory": {
    schema: DarkFactorySettingsSchema,
  },

  // tokens — a plain TS interface + residual checks; no single zod schema.
  "POST /api/tokens": { freeform: true },

  // features — hand-rolled (enforceFeatureInput / parseSectionAnswers / parseGapResult).
  "POST /api/repos/{owner}/{repo}/features": { freeform: true },
  "POST /api/repos/{owner}/{repo}/features/{id}/iterations": { freeform: true },
  "POST /api/repos/{owner}/{repo}/features/{id}/create-spec-file": {
    freeform: true,
  },
  "POST /api/repos/{owner}/{repo}/features/{id}/finalize": { freeform: true },
  "POST /api/repos/{owner}/{repo}/features/{id}/iterations/{n}/result": {
    freeform: true,
  },
  "POST /api/repos/{owner}/{repo}/features/{id}/split": { freeform: true },
};

/** Write routes with no request body: action driven by path params + server state. */
export const BODYLESS_WRITES = new Set<string>([
  "POST /api/repos/{owner}/{repo}/webhook/ensure",
  // The job to run is the path param; a courier posts it with no body at all.
  "POST /api/maintenance/{job}",
  "POST /api/cluster-agents/{id}/claim",
  // Liveness is the request itself; the timestamp is the server's clock.
  "POST /api/cluster-agents/{id}/heartbeat",
  // Which agent to bounce is the path param; there is nothing for a body to say.
  "POST /api/cluster-agents/{id}/restart",
]);

/** Look up the documented body for a write route with no `zodValidate` schema. */
export function domainBody(
  method: string,
  hapiPath: string,
): DomainBody | undefined {
  return DOMAIN_BODIES[`${method.toUpperCase()} ${hapiPath}`];
}
