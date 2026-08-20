/**
 * In-sync mirror of the dark-factory resolver/defaults. Canonical implementation
 * lives in @re-cinq/lore-shared (libs/shared/src/dark-factory-settings.ts); web-ui
 * is not a workspace member, so it keeps this mirror — matching how lib/db.ts,
 * lib/onboard-guard.ts, etc. mirror server libs. Keep both in step;
 * `dark-factory-resolve.parity.test.ts` holds the resolver and defaults in
 * lockstep with the canonical implementation.
 *
 * DECISION (#1419): not a type mirror at all — this mirrors the RESOLVER, and no
 * generated type replaces a function. The parity test is the right guard for
 * behaviour and it stays. Only the type half could ever be generated, and the
 * type half is not what this file is for.
 */

export type TrustLevel = "docs" | "tests" | "implementation" | "full";
export type ReviewMode = "trust_based" | "always" | "never";
export type CreateIssueMode = "never" | "on_gate" | "always";
export type NotifyChannel = "escalation" | "watched" | "all";

export interface DarkFactorySettings {
  enabled?: boolean;
  create_issue?: CreateIssueMode;
  auto_merge?: {
    paths?: string[];
    min_trust?: TrustLevel;
    require_green_ci?: boolean;
    require_bot_approval?: boolean;
  };
  review?: ReviewMode;
  notify?: NotifyChannel[];
  execution?: { image?: string };
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

export const DEFAULT_EXECUTION_IMAGE =
  "ghcr.io/re-cinq/lore-claude-runner:latest";

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
