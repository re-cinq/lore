import { z } from "zod";
import type { AgentDefinitionInput } from "@re-cinq/lore-shared";

/**
 * Request validation for the agents API. Maps the wire body onto the shared
 * AgentDefinitionInput (nulls for absent nullable fields). `image` is the only
 * two-key-gated field — imageFieldTouched flags when a write sets it.
 */

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
  execution_mode: z.enum(["claude-code", "graph-ingest", "station"]).default("claude-code"),
  review_required: z.boolean().default(false),
});

const normalize = (p: z.infer<typeof AgentInputSchema>): AgentDefinitionInput => ({
  name: p.name,
  model: p.model ?? null,
  timeout_minutes: p.timeout_minutes ?? null,
  prompt: p.prompt ?? null,
  image: p.image ?? null,
  execution_mode: p.execution_mode,
  review_required: p.review_required,
});

export function parseAgentInput(body: unknown): AgentDefinitionInput {
  return normalize(AgentInputSchema.parse(body));
}

export function parseAgentPatch(body: unknown): Partial<AgentDefinitionInput> {
  // A patch reuses the full schema (name optional too) but only normalizes the
  // fields actually present, so unset fields stay absent rather than nulled.
  const parsed = AgentInputSchema.partial().parse(body);
  const patch: Partial<AgentDefinitionInput> = {};
  if (parsed.name !== undefined) patch.name = parsed.name;
  if (parsed.model !== undefined) patch.model = parsed.model ?? null;
  if (parsed.timeout_minutes !== undefined) patch.timeout_minutes = parsed.timeout_minutes ?? null;
  if (parsed.prompt !== undefined) patch.prompt = parsed.prompt ?? null;
  if (parsed.image !== undefined) patch.image = parsed.image ?? null;
  if (parsed.execution_mode !== undefined) patch.execution_mode = parsed.execution_mode;
  if (parsed.review_required !== undefined) patch.review_required = parsed.review_required;
  return patch;
}

/** Image is two-key gated (ADR-025): a write that sets a non-empty image needs the approval PR. */
export function imageFieldTouched(input: { image?: string | null }): boolean {
  return typeof input.image === "string" && input.image.trim().length > 0;
}
