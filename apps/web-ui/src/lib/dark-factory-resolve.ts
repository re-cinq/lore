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

/** What each field falls back to when unset, per mode: dark mode narrows Issues, review, and notifications; light mode keeps the pre-dark behaviour. */
const MODE_DEFAULTS = {
  dark: {
    create_issue: "on_gate",
    review: "trust_based",
    notify: [] as NotifyChannel[],
  },
  light: {
    create_issue: "always",
    review: "always",
    notify: ["all"] as NotifyChannel[],
  },
} as const satisfies Record<
  string,
  Pick<ResolvedDarkFactorySettings, "create_issue" | "review" | "notify">
>;

const DEFAULT_AUTO_MERGE: ResolvedDarkFactorySettings["auto_merge"] = {
  paths: DEFAULT_AUTO_MERGE_PATHS,
  min_trust: "docs",
  require_green_ci: true,
  require_bot_approval: true,
};

export function resolveDarkFactorySettings(
  partial: DarkFactorySettings | null | undefined,
): ResolvedDarkFactorySettings {
  const given = partial ?? {};
  const enabled = given.enabled ?? false;
  const fallback = enabled ? MODE_DEFAULTS.dark : MODE_DEFAULTS.light;

  return {
    enabled,
    create_issue: orDefault(given.create_issue, fallback.create_issue),
    auto_merge: resolveAutoMerge(given.auto_merge),
    review: orDefault(given.review, fallback.review),
    notify: orDefault(given.notify, [...fallback.notify]),
  };
}

function resolveAutoMerge(
  autoMerge: DarkFactorySettings["auto_merge"],
): ResolvedDarkFactorySettings["auto_merge"] {
  const given = autoMerge ?? {};

  return {
    paths: orDefault(given.paths, DEFAULT_AUTO_MERGE.paths),
    min_trust: orDefault(given.min_trust, DEFAULT_AUTO_MERGE.min_trust),
    require_green_ci: orDefault(
      given.require_green_ci,
      DEFAULT_AUTO_MERGE.require_green_ci,
    ),
    require_bot_approval: orDefault(
      given.require_bot_approval,
      DEFAULT_AUTO_MERGE.require_bot_approval,
    ),
  };
}

function orDefault<T>(value: T | undefined | null, fallback: T): T {
  return value ?? fallback;
}
