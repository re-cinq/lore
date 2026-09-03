import { z } from "zod";
import type { ColumnMap } from "../lib/row.js";

// `lore.agent_definitions` — stored Agent CONFIG (ADR-024); resolved project row → org default → task-types.yaml.

// Recipe fields lack columns; pod resources survive deploys as catalog never overwrites existing org rows.
const PodResourcesSchema = z.object({
  requests: z.record(z.string()).optional(),
  limits: z.record(z.string()).optional(),
});

export const CatalogConfigSchema = z
  .object({
    skills: z.array(z.string()).optional(),
    pod_resources: PodResourcesSchema.optional(),
    disallowed_tools: z.array(z.string()).optional(),
    watch: z.object({ event: z.string(), path: z.string() }).optional(),
    repo_workdir: z.boolean().optional(),
    command: z.array(z.string()).optional(),
    env: z.record(z.string()).optional(),
    pod_labels: z.record(z.string()).optional(),
    needs_model: z.boolean().optional(),
  })
  .passthrough();

export type CatalogConfig = z.infer<typeof CatalogConfigSchema>;

export const AgentDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  model: z.string().nullable(),
  timeoutMinutes: z.number().nullable(),
  prompt: z.string().nullable(),
  image: z.string().nullable(),
  projectId: z.string().nullable(),
  executionMode: z.string(),
  reviewRequired: z.boolean(),
  config: CatalogConfigSchema.nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type AgentDefinition = z.infer<typeof AgentDefinitionSchema>;

export const AGENT_DEFINITION_COLUMNS = {
  id: "id",
  name: "name",
  model: "model",
  timeoutMinutes: "timeout_minutes",
  prompt: "prompt",
  image: "image",
  projectId: "project_id",
  executionMode: "execution_mode",
  reviewRequired: "review_required",
  config: "config",
  createdAt: "created_at",
  updatedAt: "updated_at",
} as const satisfies ColumnMap<AgentDefinition>;

export const AGENT_DEFINITION_TABLE = "lore.agent_definitions";

// The RESOLVED (project→org→YAML-merged) wire shape; no id/timestamps (may come from YAML), keys stay snake_case since the station runner reads it from a separate image.
export const ResolvedAgentDefinitionSchema = z.object({
  name: z.string(),
  model: z.string().nullable(),
  timeout_minutes: z.number().nullable(),
  prompt: z.string().nullable(),
  image: z.string().nullable(),
  execution_mode: z.string(),
  review_required: z.boolean(),
  project_id: z.string().nullable(),
  config: CatalogConfigSchema.nullable(),
});

export type ResolvedAgentDefinition = z.infer<
  typeof ResolvedAgentDefinitionSchema
>;
