import { z } from "zod";
import type { AgentDefinitionInput } from "@re-cinq/lore-shared";

/**
 * Request validation for the agents API. Maps the wire body onto the shared
 * AgentDefinitionInput (nulls for absent nullable fields). `image` is the only
 * two-key-gated field — imageFieldTouched flags when a write sets it.
 */

// A Kubernetes resource quantity ("500m", "2", "4Gi", "1.5G") — validated at
// the edge so a typo becomes a 400 here instead of an apply rejection in the
// cluster-agent's sync loop.
const QUANTITY = /^\d+(\.\d+)?(m|[kKMGTP]i?)?$/;
const PodResourcesSchema = z.object({
  requests: z.record(z.string().regex(QUANTITY)).optional(),
  limits: z.record(z.string().regex(QUANTITY)).optional(),
});

export type PodResources = z.infer<typeof PodResourcesSchema>;

export const AgentInputSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-z][a-z0-9-]*$/, "name must be lowercase kebab-case"),
  model: z.string().min(1).max(128).nullish(),
  timeout_minutes: z.number().int().positive().max(1440).nullish(),
  prompt: z.string().max(20000).nullish(),
  image: z.string().max(512).nullish(),
  execution_mode: z
    .enum(["claude-code", "graph-ingest", "station"])
    .default("claude-code"),
  review_required: z.boolean().default(false),
  pod_resources: PodResourcesSchema.nullish(),
});

const normalize = (
  p: z.infer<typeof AgentInputSchema>,
): AgentDefinitionInput => ({
  name: p.name,
  model: p.model ?? null,
  timeout_minutes: p.timeout_minutes ?? null,
  prompt: p.prompt ?? null,
  image: p.image ?? null,
  execution_mode: p.execution_mode,
  review_required: p.review_required,
  // config is otherwise not settable via this route (skills/disallowed_tools
  // come from the catalog seed) — pod_resources is the one key the Agents UI
  // owns, and the PUT route merges it over the resolved config so a project
  // fork keeps the keys it inherits.
  config: p.pod_resources ? { pod_resources: p.pod_resources } : null,
});

export function parseAgentInput(body: unknown): AgentDefinitionInput {
  return normalize(AgentInputSchema.parse(body));
}

/** A PUT body: the row fields actually present, plus `pod_resources` kept
 *  separate — the route merges it over the RESOLVED config (null clears it),
 *  since a project fork that wrote `{pod_resources}` alone would orphan the
 *  config keys it inherits (config is whole-object across layers). */
export type AgentPatch = Partial<AgentDefinitionInput> & {
  pod_resources?: PodResources | null;
};

export function parseAgentPatch(body: unknown): AgentPatch {
  // A patch reuses the full schema (name optional too) but only normalizes the
  // fields actually present, so unset fields stay absent rather than nulled.
  const parsed = AgentInputSchema.partial().parse(body);
  const patch: AgentPatch = {};

  if (parsed.name !== undefined) {
    patch.name = parsed.name;
  }

  if (parsed.model !== undefined) {
    patch.model = parsed.model ?? null;
  }

  if (parsed.timeout_minutes !== undefined) {
    patch.timeout_minutes = parsed.timeout_minutes ?? null;
  }

  if (parsed.prompt !== undefined) {
    patch.prompt = parsed.prompt ?? null;
  }

  if (parsed.image !== undefined) {
    patch.image = parsed.image ?? null;
  }

  if (parsed.execution_mode !== undefined) {
    patch.execution_mode = parsed.execution_mode;
  }

  if (parsed.review_required !== undefined) {
    patch.review_required = parsed.review_required;
  }

  if (parsed.pod_resources !== undefined) {
    patch.pod_resources = parsed.pod_resources ?? null;
  }

  return patch;
}

/**
 * The config a PUT should write when the body touched pod_resources: the
 * resolved config's other keys survive (whole-object config means the written
 * layer owns ALL of it), pod_resources is replaced or — on null — removed, and
 * an empty result collapses to null so the row falls through to the org layer.
 */
export function configWithPodResources(
  existing: Record<string, unknown> | null,
  podResources: PodResources | null,
): Record<string, unknown> | null {
  const { pod_resources: _replaced, ...rest } = existing ?? {};
  const next = podResources ? { ...rest, pod_resources: podResources } : rest;

  return Object.keys(next).length > 0 ? next : null;
}

/** Image is two-key gated (ADR-025): a write that sets a non-empty image needs the approval PR. */
export function imageFieldTouched(input: { image?: string | null }): boolean {
  return typeof input.image === "string" && input.image.trim().length > 0;
}
