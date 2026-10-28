/** Domain-route OpenAPI sidecar (ADR-035 fork 3): schemas for hand-validated routes + wildcard verb table. */

import type { ZodType } from "zod";
import { AgentInputSchema } from "../../work/agents/agents-schema.js";

/** Concrete verbs for method:"*" routes (currently empty: split routes to per-verb + 405 fallback). */
export const WILDCARD_METHODS: Record<string, string[]> = {};

/** Paths where wildcard route exists ONLY to answer 405; undeclaredWildcards() fails if not listed. */
export const METHOD_NOT_ALLOWED_FALLBACKS: string[] = ["/api/tokens"];

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

  // tokens — a plain TS interface + residual checks; no single zod schema.
  "POST /api/tokens": { freeform: true },
};

/** Write routes with no request body: action driven by path params + server state. */
export const BODYLESS_WRITES = new Set<string>([
  "POST /api/repos/{owner}/{repo}/webhook/ensure",
  // The job to run is the path param; a courier posts it with no body at all.
  "POST /api/maintenance/{job}",
  // The run to upgrade is the path param; its inputs and the line's newest version are read from the floor.
  "POST /api/assembly-runs/{id}/upgrade",
  // The repo is the path param; what to mirror is read from its default branch.
  "POST /api/repos/{owner}/{repo}/utopia/backfill",
  // The repo is the path param; where to start is the cursor its settings hold.
  "POST /api/repos/{owner}/{repo}/utopia/tracker",
  // The repo is the path param; every tag and published release is read from GitHub.
  "POST /api/repos/{owner}/{repo}/utopia/releases",
  // The repo is the path param; it takes nothing else, and what it forgets is the repo's own walk cursors and stored test and code commits.
  "POST /api/repos/{owner}/{repo}/utopia/reset",
  // The repo is the path param; where to start is the cursor each of its memory sources holds.
  "POST /api/repos/{owner}/{repo}/utopia/memory",
  // The org base is the deployment's GITHUB_ORG; where to start is the cursor each of its memory sources holds.
  "POST /api/utopia/memory",
  // The session to end is the bearer token the request carries.
  "POST /api/auth/logout",
]);

/** Look up the documented body for a write route with no `zodValidate` schema. */
export function domainBody(
  method: string,
  hapiPath: string,
): DomainBody | undefined {
  return DOMAIN_BODIES[`${method.toUpperCase()} ${hapiPath}`];
}
