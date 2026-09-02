import { z } from "zod";
import type { ColumnMap } from "../lib/row.js";

/**
 * `lore.agent_definitions` — the stored CONFIG an Agent runs from (ADR-024).
 *
 * DDL: migration `0015_agents_table.sql` (renamed from `lore.agents` by 0016).
 *
 * An Agent definition is config, not a run — the glossary reserves "definition"
 * for this row specifically, which is why the assembly-line side is now called a
 * BLUEPRINT. Resolution is project row → org default (`projectId IS NULL`) →
 * `task-types.yaml`, enforced by two partial unique indexes rather than by
 * application code.
 */

/**
 * The recipe fields beyond the scalar columns — what the Helm catalog seed used
 * to carry per entry and no column ever stored: a task type's skills /
 * disallowed_tools / watch / repo_workdir, a station's command / env /
 * pod_labels / needs_model. Tolerant by the same reasoning as
 * TaskTypeConfigSchema: a stale reader must keep serving the fields it knows.
 */
/** A pod resource block in Kubernetes shape (`cpu`/`memory`/`ephemeral-storage`
 *  quantity strings), stored per definition so an operator can raise one
 *  station's ceiling without a release — the catalog seed never overwrites an
 *  existing org row, so the DB value survives deploys. */
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

/**
 * The RESOLVED definition — what a caller gets after project row → org default →
 * `task-types.yaml` have been merged, and what crosses the wire to the web UI
 * and the runner.
 *
 * Deliberately not the row. It carries no `id`, `createdAt` or `updatedAt`
 * because a resolved definition may come from the YAML fallback, where no row
 * exists to have them. Its keys stay SNAKE_CASE because this is the published
 * wire shape; flipping it is expand/contract work, since the station runner
 * reads it from a separately deployed image.
 */
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
