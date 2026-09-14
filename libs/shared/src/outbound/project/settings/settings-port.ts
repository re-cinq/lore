import type { ResolvedDarkFactorySettings } from "../../../domain/dark-factory-settings.js";
import { REPO_COLUMNS, type Repo } from "../../../domain/models/repo.js";

/** One lore.repos column per named field, typed off the model. */
type RepoColumn<K extends keyof Repo> = {
  [F in K as (typeof REPO_COLUMNS)[F]]: Repo[F];
};

/** An onboarded repo (onboarding_pr_merged = true) and its last reindex stamp. */
export interface OnboardedRepo {
  full_name: string;
  last_ingested_at: Date | null;
}

/** One lore.repos row; shape = Repo model, declared once beside its columns rather than restated here (where it drifted into a Date|string union). */
export type RepoRecord = Repo;

/** A repo whose onboarding PR is open and unmerged (the merge-check poll set); onboarding_pr_url is never null here — the query filters it IS NOT NULL. */
export type PendingOnboardingRepo = RepoColumn<"id" | "fullName"> & {
  onboarding_pr_url: string;
};

/** What renaming a repo's row did: moved it in place, folded it into a row already carrying the new name, or found no row under the old name. */
export type RepoRenameOutcome = "renamed" | "merged" | "absent";

/** Repo settings port; resolve() returns fully-resolved lore.repos.settings (settings-pg reads the row then calls resolveDarkFactorySettings). Also covers repo config writes and raw lore.repos record ops (relocated from Floor inline SQL). */
export interface SettingsPort {
  resolve(repo: string): Promise<ResolvedDarkFactorySettings>;
  /** Resolved settings, or null when the repo is not onboarded (no lore.repos row). */
  resolveOrNull(repo: string): Promise<ResolvedDarkFactorySettings | null>;
  setRepoVariable(repo: string, name: string, value: string): Promise<void>;
  setRepoSecret(repo: string, name: string, value: string): Promise<void>;

  // ── raw lore.repos record ops (relocated from Floor inline SQL) ──
  /** Whole lore.repos row, or null — exists because five web-ui pages each SELECTed a different column subset; prefer rawSettings/team when that's genuinely all you need. */
  record(repo: string): Promise<RepoRecord | null>;
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
  /** Every repo Lore has a row for, onboarded or not. The implementation loop walks these, so a repo that switched the loop on before its onboarding merged is reported rather than never looked at. */
  allRepos(): Promise<string[]>;
  /** Stamp `last_ingested_at = now()` after a reindex pass. */
  markIngested(repo: string): Promise<void>;
  /** Repos with an open, unmerged onboarding PR (merge-check polls these). */
  pendingOnboardingRepos(): Promise<PendingOnboardingRepo[]>;
  /** Mark a repo's onboarding PR merged (+ stamp last_ingested_at), keyed by row id. */
  markOnboardingMergedById(id: string): Promise<void>;
  /** Forgets a repo's onboarding PR url (by row id) when that PR closed without merging — a stale non-null url would block the onboard guard forever. */
  clearOnboardingPrUrl(id: string): Promise<void>;
  /** Set the onboarding PR url for a repo. */
  setOnboardingPrUrl(repo: string, url: string): Promise<void>;
  /** Follows a GitHub rename (#2040): the row under `from` takes the name `to`, or, when onboarding already created a `to` row, hands it the agent definitions it lacks and is deleted. */
  renameRepo(from: string, to: string): Promise<RepoRenameOutcome>;
  /** Increment the repo's outcome_stats (merged_count, total_files_changed, total_hours_to_merge). */
  bumpOutcomeStats(
    repo: string,
    filesChanged: number,
    hoursToMerge: number,
  ): Promise<void>;
}
