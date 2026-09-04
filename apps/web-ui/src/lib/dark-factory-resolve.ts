// Mirror of @re-cinq/lore-shared dark-factory resolver; kept in sync by parity test (#1419)

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

function orDefault<T>(value: T | undefined | null, fallback: T): T {
  return value ?? fallback;
}

function resolveEnabled(
  partial: DarkFactorySettings | null | undefined,
): boolean {
  return partial?.enabled ?? false;
}

function resolveCreateIssue(
  partial: DarkFactorySettings | null | undefined,
  enabled: boolean,
): CreateIssueMode {
  return partial?.create_issue ?? (enabled ? "on_gate" : "always");
}

function resolveAutoMerge(
  autoMerge: DarkFactorySettings["auto_merge"],
): ResolvedDarkFactorySettings["auto_merge"] {
  return {
    paths: orDefault(autoMerge?.paths, DEFAULT_AUTO_MERGE_PATHS),
    min_trust: orDefault(autoMerge?.min_trust, "docs"),
    require_green_ci: orDefault(autoMerge?.require_green_ci, true),
    require_bot_approval: orDefault(autoMerge?.require_bot_approval, true),
  };
}

function resolveReview(
  partial: DarkFactorySettings | null | undefined,
  enabled: boolean,
): ReviewMode {
  return partial?.review ?? (enabled ? "trust_based" : "always");
}

function resolveNotify(
  partial: DarkFactorySettings | null | undefined,
  enabled: boolean,
): NotifyChannel[] {
  return partial?.notify ?? (enabled ? [] : ["all"]);
}

export function resolveDarkFactorySettings(
  partial: DarkFactorySettings | null | undefined,
): ResolvedDarkFactorySettings {
  const enabled = resolveEnabled(partial);

  return {
    enabled,
    create_issue: resolveCreateIssue(partial, enabled),
    auto_merge: resolveAutoMerge(partial?.auto_merge),
    review: resolveReview(partial, enabled),
    notify: resolveNotify(partial, enabled),
  };
}
