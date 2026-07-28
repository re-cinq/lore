import type { ResolvedDarkFactorySettings } from "../../dark-factory-settings.js";

/** An onboarded repo (onboarding_pr_merged = true) and its last reindex stamp. */
export interface OnboardedRepo {
  full_name: string;
  last_ingested_at: Date | null;
}

/** A repo whose onboarding PR is open and unmerged (the merge-check poll set). */
export interface PendingOnboardingRepo {
  id: string;
  full_name: string;
  onboarding_pr_url: string;
}

/**
 * Repo settings port. resolve() returns the fully-resolved lore.repos.settings
 * (the settings-pg adapter reads the row then calls the existing
 * resolveDarkFactorySettings — no new resolution logic). Repo config writes
 * (GitHub vars/secrets) and the raw `lore.repos` record ops (the inline SQL the
 * Floor jobs used to hand-roll) round out the surface.
 */
export interface SettingsPort {
  resolve(repo: string): Promise<ResolvedDarkFactorySettings>;
  /** Resolved settings, or null when the repo is not onboarded (no lore.repos row). */
  resolveOrNull(repo: string): Promise<ResolvedDarkFactorySettings | null>;
  setRepoVariable(repo: string, name: string, value: string): Promise<void>;
  setRepoSecret(repo: string, name: string, value: string): Promise<void>;

  // ── raw lore.repos record ops (relocated from Floor inline SQL) ──
  /** The raw settings JSONB for a repo, or null when there is no row / no settings. */
  rawSettings(repo: string): Promise<Record<string, unknown> | null>;
  /** Overwrite the settings JSONB for a repo. */
  updateSettings(
    repo: string,
    settings: Record<string, unknown>,
  ): Promise<void>;
  /** The repo's team (schema) name, or null. */
  team(repo: string): Promise<string | null>;
  /** The first repo full_name mapped to a team (schema), or null. */
  repoForTeam(team: string): Promise<string | null>;
  /** All onboarded repos with their last reindex stamp (the reindex scan set). */
  onboardedRepos(): Promise<OnboardedRepo[]>;
  /** True when the repo's onboarding PR has merged (gap-detect's per-repo guard). */
  isOnboarded(repo: string): Promise<boolean>;
  /** Stamp `last_ingested_at = now()` after a reindex pass. */
  markIngested(repo: string): Promise<void>;
  /** Repos with an open, unmerged onboarding PR (merge-check polls these). */
  pendingOnboardingRepos(): Promise<PendingOnboardingRepo[]>;
  /** Mark a repo's onboarding PR merged (+ stamp last_ingested_at), keyed by row id. */
  markOnboardingMergedById(id: string): Promise<void>;
  /**
   * Forget a repo's onboarding PR url, keyed by row id. Used when that PR was
   * closed without merging: the onboard guard reads a non-null url as "an
   * onboarding is still in progress", so a stale one blocks the repo forever.
   */
  clearOnboardingPrUrl(id: string): Promise<void>;
  /** Set the onboarding PR url for a repo. */
  setOnboardingPrUrl(repo: string, url: string): Promise<void>;
  /** Increment the repo's outcome_stats (merged_count, total_files_changed, total_hours_to_merge). */
  bumpOutcomeStats(
    repo: string,
    filesChanged: number,
    hoursToMerge: number,
  ): Promise<void>;
}
