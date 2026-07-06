/**
 * The OpenAPI generator's domain-route sidecar (ADR-035, design fork 3).
 *
 * Four routes validate through domain validators rather than `options.validate`
 * (ADR-034 §5 kept transforming validators in their handlers), so the generator
 * cannot recover a request schema off the route. This is the ONE place those
 * exceptions are declared:
 *
 * - `agents` and `dark-factory` already export zod schemas — lifted here for an
 *   accurate request body at zero new schema cost.
 * - `features` and `tokens` are hand-rolled (no single zod schema) — documented as
 *   freeform `object` bodies and recorded as uncovered.
 *
 * It also supplies the concrete verbs for the two `method: "*"` routes, which hapi
 * expresses as a wildcard the document cannot. The drift-guard test cross-checks
 * this table against the live route list so it cannot silently drift.
 */

import type { ZodType } from "zod";
import { AgentInputSchema } from "../features/agents/agents-schema.js";
import { DarkFactorySettingsSchema } from "../features/dark-factory/dark-factory-settings.js";

/** Concrete verbs for `method: "*"` routes, keyed by the hapi path. */
export const WILDCARD_METHODS: Record<string, string[]> = {
  "/api/tokens": ["GET", "POST"],
  "/api/repos/{owner}/{repo}/settings/dark-factory": ["GET", "PUT"],
};

/** How a domain-validated write route's request body is documented. */
export type DomainBody = { schema: ZodType; freeform?: false } | { schema?: undefined; freeform: true };

/**
 * Request body for a write route that carries no `zodValidate` schema, keyed by
 * `"METHOD path"` (the hapi path, verbatim). `schema` lifts an existing zod
 * schema; `freeform: true` documents a permissive object and marks the route
 * uncovered.
 */
export const DOMAIN_BODIES: Record<string, DomainBody> = {
  // agents — the domain validator IS a zod schema (agents-schema.ts).
  "POST /api/repos/{owner}/{repo}/agent-definitions": { schema: AgentInputSchema },
  "PUT /api/repos/{owner}/{repo}/agent-definitions/{name}": { schema: AgentInputSchema },

  // dark-factory — likewise (dark-factory-settings.ts).
  "PUT /api/repos/{owner}/{repo}/settings/dark-factory": { schema: DarkFactorySettingsSchema },

  // tokens — a plain TS interface + residual checks; no single zod schema.
  "POST /api/tokens": { freeform: true },

  // features — hand-rolled (enforceFeatureInput / parseSectionAnswers / parseGapResult).
  "POST /api/repos/{owner}/{repo}/features": { freeform: true },
  "POST /api/repos/{owner}/{repo}/features/{id}/iterations": { freeform: true },
  "POST /api/repos/{owner}/{repo}/features/{id}/iterations/{n}/result": { freeform: true },
  "POST /api/repos/{owner}/{repo}/features/{id}/split": { freeform: true },
};

/**
 * Write routes that legitimately carry NO request body — the action is driven by
 * path params + server state, so no schema is missing. Keyed by `"METHOD path"`.
 * (`parse: false` webhook routes handle their own HMAC body and are detected
 * separately.)
 */
export const BODYLESS_WRITES = new Set<string>([
  "POST /api/repos/{owner}/{repo}/webhook/ensure",
  "POST /api/repos/{owner}/{repo}/features/{id}/finalize",
]);

/** Look up the documented body for a write route with no `zodValidate` schema. */
export function domainBody(method: string, hapiPath: string): DomainBody | undefined {
  return DOMAIN_BODIES[`${method.toUpperCase()} ${hapiPath}`];
}
