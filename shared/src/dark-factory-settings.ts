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
