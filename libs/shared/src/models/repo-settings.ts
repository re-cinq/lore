import { z } from "zod";
import {
  DarkFactorySettingsSchema,
  TrustLevelSchema,
} from "./dark-factory-settings.js";

/**
 * The `lore.repos.settings` JSONB column.
 *
 * Keys stay SNAKE_CASE for the same reason the dark-factory block's do: this is
 * the stored document and the settings API's request body, not a row. Every key
 * is optional — a repo carries only what it has overridden, and the resolver
 * supplies the rest.
 *
 * Unknown keys PASS THROUGH. The document is written by several edges (the
 * settings page, the MCP tool, onboarding) and a strict schema here would
 * silently drop a key one of them added, turning a read-modify-write into data
 * loss.
 */

/** Per-task-type overrides merged over `task-types.yaml`; repo values win. */
export const TaskOverrideSchema = z
  .object({
    model: z.string().optional(),
    timeout_minutes: z.number().optional(),
    system_prompt_suffix: z.string().optional(),
    review_required: z.boolean().optional(),
    execution: z.object({ image: z.string().optional() }).optional(),
  })
  .passthrough();

export const RepoSettingsSchema = z
  .object({
    dark_factory: DarkFactorySettingsSchema.optional(),
    trust: z
      .object({ level: TrustLevelSchema.optional() })
      .passthrough()
      .optional(),
    task_types: z.array(z.string()).optional(),
    task_overrides: z.record(TaskOverrideSchema).optional(),
    auto_review: z.boolean().optional(),
    // Top-level on purpose: the loop never merges, so it stays outside the
    // two-key dark_factory ceremony (implementation-loop FR7).
    implementation_loop: z
      .object({ enabled: z.boolean().optional() })
      .passthrough()
      .optional(),
    cross_repo: z.boolean().optional(),
    cross_repo_repos: z.array(z.string()).optional(),
    slack_channel_id: z.string().optional(),
    dispatch_label: z.string().optional(),
    dispatch_default_type: z.string().optional(),
    test_commands: z.unknown().optional(),
    incidents: z.array(z.unknown()).optional(),
  })
  .passthrough();

export type TaskOverride = z.infer<typeof TaskOverrideSchema>;
export type RepoSettings = z.infer<typeof RepoSettingsSchema>;
