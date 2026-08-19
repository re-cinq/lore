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
  createdAt: "created_at",
  updatedAt: "updated_at",
} as const satisfies ColumnMap<AgentDefinition>;

export const AGENT_DEFINITION_TABLE = "lore.agent_definitions";
