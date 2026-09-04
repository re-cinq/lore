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

type ParsedAgentPatch = z.infer<ReturnType<typeof AgentInputSchema.partial>>;

const nameField = (p: ParsedAgentPatch): Partial<AgentPatch> =>
  p.name !== undefined ? { name: p.name } : {};

const modelField = (p: ParsedAgentPatch): Partial<AgentPatch> =>
  p.model !== undefined ? { model: p.model ?? null } : {};

const timeoutMinutesField = (p: ParsedAgentPatch): Partial<AgentPatch> =>
  p.timeout_minutes !== undefined
    ? { timeout_minutes: p.timeout_minutes ?? null }
    : {};

const promptField = (p: ParsedAgentPatch): Partial<AgentPatch> =>
  p.prompt !== undefined ? { prompt: p.prompt ?? null } : {};

const imageField = (p: ParsedAgentPatch): Partial<AgentPatch> =>
  p.image !== undefined ? { image: p.image ?? null } : {};

const executionModeField = (p: ParsedAgentPatch): Partial<AgentPatch> =>
  p.execution_mode !== undefined ? { execution_mode: p.execution_mode } : {};

const reviewRequiredField = (p: ParsedAgentPatch): Partial<AgentPatch> =>
  p.review_required !== undefined ? { review_required: p.review_required } : {};

const podResourcesField = (p: ParsedAgentPatch): Partial<AgentPatch> =>
  p.pod_resources !== undefined
    ? { pod_resources: p.pod_resources ?? null }
    : {};

export function parseAgentPatch(body: unknown): AgentPatch {
  const parsed = AgentInputSchema.partial().parse(body);

  return {
    ...nameField(parsed),
    ...modelField(parsed),
    ...timeoutMinutesField(parsed),
    ...promptField(parsed),
    ...imageField(parsed),
    ...executionModeField(parsed),
    ...reviewRequiredField(parsed),
    ...podResourcesField(parsed),
  };
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
