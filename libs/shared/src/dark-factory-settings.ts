/**
 * The dark-factory RESOLVER and its defaults. Shared between mcp-server (writes
 * the JSONB), the agent (reads + applies), and the Station pod runner.
 *
 * The SHAPES live in `models/dark-factory-settings.ts` — one declaration beside
 * the other stored types — and are re-exported here so the ~40 existing importers
 * keep working. Types and resolver stayed together historically; splitting them
 * is what stops a settings shape being restated per consumer.
 */

export {
  DarkFactoryAutoMergeSchema,
  DarkFactoryExecutionSchema,
  DarkFactorySettingsSchema,
  ResolvedDarkFactorySettingsSchema,
  CreateIssueModeSchema,
  NotifyChannelSchema,
  ReviewModeSchema,
  TrustLevelSchema,
} from "./models/dark-factory-settings.js";
export type {
  CreateIssueMode,
  DarkFactoryAutoMerge,
  DarkFactoryExecution,
  DarkFactorySettings,
  NotifyChannel,
  ResolvedDarkFactorySettings,
  ReviewMode,
  TrustLevel,
} from "./models/dark-factory-settings.js";

import type {
  DarkFactoryExecution,
  DarkFactorySettings,
  ResolvedDarkFactorySettings,
  TrustLevel,
} from "./models/dark-factory-settings.js";

export const DEFAULT_AUTO_MERGE_PATHS = [
  "specs/**",
  "adrs/**",
  "*.md",
  "CLAUDE.md",
  ".claude/**",
];

/**
 * Apply defaults to a (possibly partial) parsed settings document.
 * Defaults differ between dark-mode-on (`enabled: true`) and the
 * conservative opt-out posture.
 *
 * Empty `notify` list in dark mode is correct: `decideNotify` always
 * fires `escalation` regardless, so listing it explicitly was redundant
 * noise.
 */
export function resolveDarkFactorySettings(
  partial: DarkFactorySettings | null | undefined,
): ResolvedDarkFactorySettings {
  const enabled = partial?.enabled ?? false;

  return {
    enabled,
    create_issue: partial?.create_issue ?? (enabled ? "on_gate" : "always"),
    auto_merge: {
      paths: partial?.auto_merge?.paths ?? DEFAULT_AUTO_MERGE_PATHS,
      min_trust: partial?.auto_merge?.min_trust ?? "docs",
      require_green_ci: partial?.auto_merge?.require_green_ci ?? true,
      require_bot_approval: partial?.auto_merge?.require_bot_approval ?? true,
    },
    review: partial?.review ?? (enabled ? "trust_based" : "always"),
    notify: partial?.notify ?? (enabled ? [] : ["all"]),
  };
}

/** docs(1) < tests(2) < implementation(3) < full(4) */
const TRUST_ORDER: Record<TrustLevel, number> = {
  docs: 1,
  tests: 2,
  implementation: 3,
  full: 4,
};

export function trustMeets(
  actual: TrustLevel | undefined,
  min: TrustLevel,
): boolean {
  if (!actual) {
    return false;
  }

  return TRUST_ORDER[actual] >= TRUST_ORDER[min];
}

/** The container image a task runs in by default (ADR-025). */
export const DEFAULT_EXECUTION_IMAGE =
  "ghcr.io/re-cinq/lore-claude-runner:latest";

/** Repo settings shape needed to resolve a task's execution image. */
export interface ExecutionImageSettings {
  dark_factory?: DarkFactorySettings | null;
  task_overrides?: Record<
    string,
    { execution?: DarkFactoryExecution } | undefined
  > | null;
}

/**
 * Resolve which container image a task's Station runs in, newest-wins:
 * per-task-type override → per-repo `dark_factory.execution.image` →
 * the platform default (ADR-025).
 */
export function resolveExecutionImage(
  settings: ExecutionImageSettings | null | undefined,
  taskType: string,
): string {
  return (
    settings?.task_overrides?.[taskType]?.execution?.image ??
    settings?.dark_factory?.execution?.image ??
    DEFAULT_EXECUTION_IMAGE
  );
}
