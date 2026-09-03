import { z } from "zod";
import type { AgentDefinitionInput } from "@re-cinq/lore-shared";

// Agents API validation; image is two-key-gated (imageFieldTouched flag).

// Kubernetes resource quantity validated at edge to catch typos early.
const QUANTITY = /^\d+(\.\d+)?(m|[kKMGTPE]i?)?$/;
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

// POST body: row fields + pod_resources; route merges over inherited config (org → yaml).
export type AgentCreate = AgentDefinitionInput & {
  pod_resources?: PodResources;
};

const normalize = (p: z.infer<typeof AgentInputSchema>): AgentCreate => ({
  name: p.name,
  model: p.model ?? null,
  timeout_minutes: p.timeout_minutes ?? null,
  prompt: p.prompt ?? null,
  image: p.image ?? null,
  execution_mode: p.execution_mode,
  review_required: p.review_required,
  // config not settable (catalog seed); only pod_resources.
  config: null,
  ...(p.pod_resources ? { pod_resources: p.pod_resources } : {}),
});

export function parseAgentInput(body: unknown): AgentCreate {
  return normalize(AgentInputSchema.parse(body));
}

// PUT body: row fields + separate pod_resources; adapter merges over inherited layer config.
export type AgentPatch = Partial<AgentDefinitionInput> & {
  pod_resources?: PodResources | null;
};

export function parseAgentPatch(body: unknown): AgentPatch {
  // Patch normalizes only present fields; unset fields stay absent (not nulled).
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

// Merge pod_resources into config; empty result → null → fall through to org layer.
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
