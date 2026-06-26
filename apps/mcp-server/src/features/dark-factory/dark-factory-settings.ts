import { z } from "zod";

/**
 * The canonical dark-factory resolver, resolved types, and defaults live in
 * `@re-cinq/lore-shared` (one source for agent + mcp + Job pod). They are
 * re-exported here so existing mcp importers keep their import path. This file
 * now holds ONLY the mcp-specific input-validation Zod schema + the two-key
 * field check — everything else is shared.
 */
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

// Repo-level execution also carries the cutover backend opt-in (ADR-031, #688):
// which controller runs this repo's tasks. Per-task-type overrides keep image only.
const RepoExecutionSchema = ExecutionSchema.extend({
  backend: z.enum(["agent-cr", "loretask"]).optional(),
});

export const DarkFactorySettingsSchema = z.object({
  enabled: z.boolean().optional(),
  create_issue: z.enum(["never", "on_gate", "always"]).optional(),
  auto_merge: AutoMergeSchema.optional(),
  review: z.enum(["trust_based", "always", "never"]).optional(),
  notify: z.array(NotifyChannel).optional(),
  execution: RepoExecutionSchema.optional(),
});

/**
 * Validates a partial settings patch. Throws ZodError on invalid shape. The
 * two-key check (FR3.9) is enforced separately by {@link twoKeyFieldsTouched}.
 */
export function parseDarkFactorySettings(raw: unknown): DarkFactorySettings {
  return DarkFactorySettingsSchema.parse(raw) as DarkFactorySettings;
}

/**
 * Per-task-type overrides (`settings.task_overrides.<type>`). Merged over the
 * global `task-types.yaml` at task creation. `execution.image` is the BYO
 * toolchain image for that task type (ADR-025) and is two-key gated like
 * `dark_factory.execution.image`.
 */
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

/**
 * Returns the field paths in `patch` that require the two-key ceremony
 * (admin scope + CODEOWNERS-approval PR). Per FR3.9 + R9.
 *
 * Two-key fields:
 *   - dark_factory.enabled (any change to)
 *   - dark_factory.auto_merge.paths (any change)
 *   - dark_factory.auto_merge.require_green_ci (only when set to false — downgrade)
 *   - dark_factory.auto_merge.require_bot_approval (only when set to false — downgrade)
 *   - dark_factory.execution.image (any change — controls what code runs + which secrets it can read)
 *   - task_overrides.<type>.execution.image (any change — same boundary, per task type)
 *
 * All other sub-fields require admin scope only.
 */
export function twoKeyFieldsTouched(
  patch: DarkFactorySettings,
  taskOverrides?: TaskOverridesPatch,
): string[] {
  const touched: string[] = [];
  if (patch.enabled !== undefined) touched.push("enabled");
  if (patch.auto_merge?.paths !== undefined) touched.push("auto_merge.paths");
  if (patch.auto_merge?.require_green_ci === false) {
    touched.push("auto_merge.require_green_ci");
  }
  if (patch.auto_merge?.require_bot_approval === false) {
    touched.push("auto_merge.require_bot_approval");
  }
  if (patch.execution?.image !== undefined) touched.push("execution.image");
  for (const [type, ov] of Object.entries(taskOverrides ?? {})) {
    if (ov?.execution?.image !== undefined) {
      touched.push(`task_overrides.${type}.execution.image`);
    }
  }
  return touched;
}
