/**
 * Canonical dark-factory settings types + resolver. Shared between
 * mcp-server (writes the JSONB), agent (reads + applies), and the
 * forthcoming GKE Job pod runner (reads via env). Centralized here so
 * the three consumers cannot drift.
 *
 * The Zod schema for input validation lives in the mcp-server (it's
 * the only edge that accepts raw user input). Both consumers depend
 * on the same {@link ResolvedDarkFactorySettings} shape and the same
 * defaulting logic.
 */

export type TrustLevel = "docs" | "tests" | "implementation" | "full";
export type ReviewMode = "trust_based" | "always" | "never";
export type CreateIssueMode = "never" | "on_gate" | "always";
export type NotifyChannel = "escalation" | "watched" | "all";

export interface DarkFactoryAutoMerge {
  paths?: string[];
  min_trust?: TrustLevel;
  require_green_ci?: boolean;
  require_bot_approval?: boolean;
}

export interface DarkFactorySettings {
  enabled?: boolean;
  create_issue?: CreateIssueMode;
  auto_merge?: DarkFactoryAutoMerge;
  review?: ReviewMode;
  notify?: NotifyChannel[];
  execution?: DarkFactoryExecution;
}

/**
 * Per-repo execution knobs. `image` is the container image a task's Station
 * runs in (ADR-025). All tasks run on the ai-agent-subsystem (`agent-cr`).
 */
export interface DarkFactoryExecution {
  image?: string;
}

export interface ResolvedDarkFactorySettings {
  enabled: boolean;
  create_issue: CreateIssueMode;
  auto_merge: {
    paths: string[];
    min_trust: TrustLevel;
    require_green_ci: boolean;
    require_bot_approval: boolean;
  };
  review: ReviewMode;
  notify: NotifyChannel[];
}

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
      require_bot_approval:
        partial?.auto_merge?.require_bot_approval ?? true,
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
  if (!actual) return false;
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
