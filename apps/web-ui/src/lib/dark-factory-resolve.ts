// Mirror of @re-cinq/lore-shared dark-factory resolver; kept in sync by parity test (#1419)

export type TrustLevel = "docs" | "tests" | "implementation" | "full";
export type ReviewMode = "trust_based" | "always" | "never";
export type CreateIssueMode = "never" | "on_gate" | "always";
export type NotifyChannel = "escalation" | "watched" | "all";

export interface DarkFactorySettings {
  enabled?: boolean;
  create_issue?: CreateIssueMode;
  auto_merge?: {
    enabled?: boolean;
    paths?: string[];
    escalate_paths?: string[];
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
    enabled: boolean;
    paths: string[];
    escalate_paths: string[];
    min_trust: TrustLevel;
    require_green_ci: boolean;
    require_bot_approval: boolean;
  };
  review: ReviewMode;
  notify: NotifyChannel[];
}

export const DEFAULT_AUTO_MERGE_PATHS = ["specs/**", "adrs/**", "*.md"];

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

const DEFAULT_AUTO_MERGE: Omit<
  ResolvedDarkFactorySettings["auto_merge"],
  "enabled"
> = {
  paths: DEFAULT_AUTO_MERGE_PATHS,
  escalate_paths: [],
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
    auto_merge: resolveAutoMerge(given),
    review: orDefault(given.review, fallback.review),
    notify: orDefault(given.notify, [...fallback.notify]),
  };
}

/** Auto-merge follows dark mode unless the repo says otherwise. */
function resolveAutoMerge(
  given: DarkFactorySettings,
): ResolvedDarkFactorySettings["auto_merge"] {
  const am = given.auto_merge ?? {};
  const d = DEFAULT_AUTO_MERGE;

  return {
    enabled: orDefault(am.enabled, given.enabled ?? false),
    paths: orDefault(am.paths, d.paths),
    escalate_paths: orDefault(am.escalate_paths, d.escalate_paths),
    min_trust: orDefault(am.min_trust, d.min_trust),
    require_green_ci: orDefault(am.require_green_ci, d.require_green_ci),
    require_bot_approval: orDefault(
      am.require_bot_approval,
      d.require_bot_approval,
    ),
  };
}

function orDefault<T>(value: T | undefined | null, fallback: T): T {
  return value ?? fallback;
}
