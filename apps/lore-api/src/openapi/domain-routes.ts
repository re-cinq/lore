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
 * It also names the concrete verbs of any `method: "*"` route that means to serve
 * them, which hapi expresses as a wildcard the document cannot. That table is
 * empty today — see {@link WILDCARD_METHODS}.
 */

import type { ZodType } from "zod";
import { AgentInputSchema } from "../features/agents/agents-schema.js";
import { DarkFactorySettingsSchema } from "../features/dark-factory/dark-factory-settings.js";

/**
 * Concrete verbs for `method: "*"` routes, keyed by the hapi path.
 *
 * EMPTY, and that is the point: `/api/tokens` and the dark-factory settings path
 * each used to be one wildcard route serving two verbs, which the generator
 * could only document as the union of both answers. They are split into concrete
 * per-verb routes now, each declaring its own contract; the wildcard route that
 * remains at each path is a 405 fallback and documents nothing. A path absent
 * from this table contributes no operations, which is exactly right for one.
 *
 * A future wildcard route that DOES mean to serve real verbs adds its entry here.
 */
export const WILDCARD_METHODS: Record<string, string[]> = {};

/**
 * Paths whose `method: "*"` route exists ONLY to answer 405.
 *
 * Every wildcard route must appear here or in {@link WILDCARD_METHODS}, and
 * `undeclaredWildcards` fails the one that appears in neither. That is what
 * closes the gap the path-count assertion cannot see: a wildcard meaning to
 * serve a real verb on a path that is ALREADY documented adds no new path key,
 * so nothing else notices the operation going missing from the document.
 *
 * The claim each entry makes — "this route refuses every verb it receives" — is
 * held to behaviour by the routes' own 405 tests, not by this list.
 */
export const METHOD_NOT_ALLOWED_FALLBACKS: string[] = [
  "/api/tokens",
  "/api/repos/{owner}/{repo}/settings/dark-factory",
];

/** How a domain-validated write route's request body is documented. */
export type DomainBody =
  | { schema: ZodType; freeform?: false }
  | { schema?: undefined; freeform: true };

/**
 * Request body for a write route that carries no `zodValidate` schema, keyed by
 * `"METHOD path"` (the hapi path, verbatim). `schema` lifts an existing zod
 * schema; `freeform: true` documents a permissive object and marks the route
 * uncovered.
 */
export const DOMAIN_BODIES: Record<string, DomainBody> = {
  // agents — the domain validator IS a zod schema (agents-schema.ts).
  "POST /api/repos/{owner}/{repo}/agent-definitions": {
    schema: AgentInputSchema,
  },
  "PUT /api/repos/{owner}/{repo}/agent-definitions/{name}": {
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
  // Accepting carries the same `user_answers` a refine does — the author fills the
  // form and accepts in one motion, and those answers belong in the accepted plan.
  // Both paths while the UI catches up; `/finalize` retires after the UI deploys.
  "POST /api/repos/{owner}/{repo}/features/{id}/create-spec-file": {
    freeform: true,
  },
  "POST /api/repos/{owner}/{repo}/features/{id}/finalize": { freeform: true },
  "POST /api/repos/{owner}/{repo}/features/{id}/iterations/{n}/result": {
    freeform: true,
  },
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
  // The job to run is the path param; a courier posts it with no body at all.
  "POST /api/maintenance/{job}",
  // The claim is driven by the claimant's registered identity (path id + bearer)
  // and the queue's state; there is nothing for a body to say.
  "POST /api/cluster-agents/{id}/claim",
]);

/** Look up the documented body for a write route with no `zodValidate` schema. */
export function domainBody(
  method: string,
  hapiPath: string,
): DomainBody | undefined {
  return DOMAIN_BODIES[`${method.toUpperCase()} ${hapiPath}`];
}
