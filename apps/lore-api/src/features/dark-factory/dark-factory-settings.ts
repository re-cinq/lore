import { z } from "zod";

/** Canonical dark-factory settings resolver + types live in @re-cinq/lore-shared; re-exported for mcp compatibility. */
export {
  resolveDarkFactorySettings as resolveSettings,
  resolveExecutionImage,
  trustMeets,
  DEFAULT_AUTO_MERGE_PATHS,
  DEFAULT_EXECUTION_IMAGE,
} from "@re-cinq/lore-shared";
export type {
  DarkFactorySettings,
  DarkFactoryAutoMerge,
  DarkFactoryExecution,
  ResolvedDarkFactorySettings,
  TrustLevel as DarkFactoryTrustLevel,
} from "@re-cinq/lore-shared";

import type { DarkFactorySettings } from "@re-cinq/lore-shared";

const TrustLevelEnum = z.enum(["docs", "tests", "implementation", "full"]);

const AutoMergeSchema = z.object({
  paths: z.array(z.string()).max(32).optional(),
  min_trust: TrustLevelEnum.optional(),
  require_green_ci: z.boolean().optional(),
  require_bot_approval: z.boolean().optional(),
});

const NotifyChannel = z.enum(["escalation", "watched", "all"]);

const ExecutionSchema = z.object({
  image: z.string().min(1).max(256).optional(),
});

export const DarkFactorySettingsSchema = z.object({
  enabled: z.boolean().optional(),
  create_issue: z.enum(["never", "on_gate", "always"]).optional(),
  auto_merge: AutoMergeSchema.optional(),
  review: z.enum(["trust_based", "always", "never"]).optional(),
  notify: z.array(NotifyChannel).optional(),
  execution: ExecutionSchema.optional(),
});

/** Validates a partial settings patch; throws ZodError on invalid shape. Two-key check (FR3.9) enforced separately. */
export function parseDarkFactorySettings(raw: unknown): DarkFactorySettings {
  return DarkFactorySettingsSchema.parse(raw) as DarkFactorySettings;
}

/** Per-task-type overrides (merged over task-types.yaml); execution.image is two-key gated (ADR-025). */
const TaskOverrideSchema = z.object({
  model: z.string().min(1).max(128).optional(),
  timeout_minutes: z.number().int().positive().max(1440).optional(),
  system_prompt_suffix: z.string().max(8000).optional(),
  review_required: z.boolean().optional(),
  prompt_template: z.string().max(8000).optional(),
  execution: ExecutionSchema.optional(),
});

export const TaskOverridesSchema = z.record(z.string(), TaskOverrideSchema);
export type TaskOverridesPatch = z.infer<typeof TaskOverridesSchema>;

export function parseTaskOverrides(raw: unknown): TaskOverridesPatch {
  return TaskOverridesSchema.parse(raw);
}

/** Returns field paths requiring two-key ceremony (admin + CODEOWNERS PR); see FR3.9 + R9 for details. */
export function twoKeyFieldsTouched(
  patch: DarkFactorySettings,
  taskOverrides?: TaskOverridesPatch,
): string[] {
  const touched: string[] = [];

  if (patch.enabled !== undefined) {
    touched.push("enabled");
  }

  if (patch.auto_merge?.paths !== undefined) {
    touched.push("auto_merge.paths");
  }

  if (patch.auto_merge?.require_green_ci === false) {
    touched.push("auto_merge.require_green_ci");
  }

  if (patch.auto_merge?.require_bot_approval === false) {
    touched.push("auto_merge.require_bot_approval");
  }

  if (patch.execution?.image !== undefined) {
    touched.push("execution.image");
  }

  for (const [type, ov] of Object.entries(taskOverrides ?? {})) {
    if (ov?.execution?.image !== undefined) {
      touched.push(`task_overrides.${type}.execution.image`);
    }
  }

  return touched;
}
