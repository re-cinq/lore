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

export const DarkFactorySettingsSchema = z.object({
  enabled: z.boolean().optional(),
  create_issue: z.enum(["never", "on_gate", "always"]).optional(),
  auto_merge: AutoMergeSchema.optional(),
  review: z.enum(["trust_based", "always", "never"]).optional(),
  notify: z.array(NotifyChannel).optional(),
  execution: ExecutionSchema.optional(),
});

/**
 * Validates a partial settings patch. Throws ZodError on invalid shape. The
 * two-key check (FR3.9) is enforced separately by {@link twoKeyFieldsTouched}.
 */
export function parseDarkFactorySettings(raw: unknown): DarkFactorySettings {
  return DarkFactorySettingsSchema.parse(raw) as DarkFactorySettings;
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
 *
 * All other sub-fields require admin scope only.
 */
export function twoKeyFieldsTouched(patch: DarkFactorySettings): string[] {
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
  return touched;
}
