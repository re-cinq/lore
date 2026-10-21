import { z } from "zod";
import type { ColumnMap } from "../../lib/row.js";

export const SkillDefinitionSchema = z.object({
  name: z.string(),
  title: z.string(),
  description: z.string(),
  model: z.string().nullable(),
  content: z.string(),
  enabled: z.boolean(),
  projectId: z.string().nullable(),
});

export type SkillDefinition = z.infer<typeof SkillDefinitionSchema>;

export const SKILL_DEFINITION_COLUMNS = {
  name: "name",
  title: "title",
  description: "description",
  model: "model",
  content: "content",
  enabled: "enabled",
  projectId: "project_id",
} as const satisfies ColumnMap<SkillDefinition>;

export const SKILL_DEFINITION_TABLE = "lore.skill_definitions";
