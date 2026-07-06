import {
  resolveDarkFactorySettings,
  type DarkFactorySettings,
  type ResolvedDarkFactorySettings,
} from "../../dark-factory-settings.js";
import type { SettingsPort, OnboardedRepo, PendingOnboardingRepo } from "./settings-port.js";

/** A seeded `lore.repos` row for the in-memory settings double. */
export interface SeedRepo {
  id?: string;
  onboarding_pr_url?: string | null;
  outcome_stats?: Record<string, number> | null;
  full_name: string;
  team?: string | null;
  settings?: Record<string, unknown> | null;
  last_ingested_at?: Date | null;
  onboarding_pr_merged?: boolean;
}

/**
 * In-memory {@link SettingsPort}: the behavioral double over seeded `lore.repos`
 * rows, so jobs that read/write repo settings stay testable without a live DB.
 * Repo var/secret writes are captured in {@link vars}/{@link secrets}.
 */
export class InMemorySettings implements SettingsPort {
  readonly vars: Array<{ repo: string; name: string; value: string }> = [];
  readonly secrets: Array<{ repo: string; name: string; value: string }> = [];

  constructor(public repos: SeedRepo[] = []) {}

  private row(repo: string): SeedRepo | undefined {
    return this.repos.find((r) => r.full_name === repo);
  }

  async resolve(repo: string): Promise<ResolvedDarkFactorySettings> {
    return resolveDarkFactorySettings(this.darkFactory(repo));
  }

  async resolveOrNull(repo: string): Promise<ResolvedDarkFactorySettings | null> {
    if (!this.row(repo)) return null;
    return resolveDarkFactorySettings(this.darkFactory(repo));
  }

  private darkFactory(repo: string): DarkFactorySettings | undefined {
    const settings = this.row(repo)?.settings as { dark_factory?: DarkFactorySettings } | undefined;
    return settings?.dark_factory;
  }

  async setRepoVariable(repo: string, name: string, value: string): Promise<void> {
    this.vars.push({ repo, name, value });
  }

  async setRepoSecret(repo: string, name: string, value: string): Promise<void> {
    this.secrets.push({ repo, name, value });
  }

  async rawSettings(repo: string): Promise<Record<string, unknown> | null> {
    const row = this.row(repo);
    if (!row) return null;
    return row.settings ?? null;
  }

  async updateSettings(repo: string, settings: Record<string, unknown>): Promise<void> {
    const row = this.row(repo);
    if (row) row.settings = settings;
    else this.repos.push({ full_name: repo, settings });
  }

  async team(repo: string): Promise<string | null> {
    return this.row(repo)?.team ?? null;
  }

  async repoForTeam(team: string): Promise<string | null> {
    return this.repos.find((r) => r.team === team)?.full_name ?? null;
  }

  async onboardedRepos(): Promise<OnboardedRepo[]> {
    return this.repos
      .filter((r) => r.onboarding_pr_merged === true)
      .map((r) => ({ full_name: r.full_name, last_ingested_at: r.last_ingested_at ?? null }));
  }

  async isOnboarded(repo: string): Promise<boolean> {
    return this.repos.some((r) => r.full_name === repo && r.onboarding_pr_merged === true);
  }

  async markIngested(repo: string): Promise<void> {
    const row = this.row(repo);
    if (row) row.last_ingested_at = new Date();
  }

  async pendingOnboardingRepos(): Promise<PendingOnboardingRepo[]> {
    return this.repos
      .filter((r) => r.onboarding_pr_merged !== true && r.onboarding_pr_url != null)
      .map((r) => ({ id: r.id ?? "", full_name: r.full_name, onboarding_pr_url: r.onboarding_pr_url as string }));
  }

  async markOnboardingMergedById(id: string): Promise<void> {
    const row = this.repos.find((r) => r.id === id);
    if (row) {
      row.onboarding_pr_merged = true;
      row.last_ingested_at = new Date();
    }
  }

  async setOnboardingPrUrl(repo: string, url: string): Promise<void> {
    const row = this.row(repo);
    if (row) row.onboarding_pr_url = url;
    else this.repos.push({ full_name: repo, onboarding_pr_url: url });
  }

  async bumpOutcomeStats(repo: string, filesChanged: number, hoursToMerge: number): Promise<void> {
    const row = this.row(repo);
    if (!row) return;
    const stats = row.outcome_stats ?? {};
    row.outcome_stats = {
      ...stats,
      merged_count: (stats.merged_count ?? 0) + 1,
      total_files_changed: (stats.total_files_changed ?? 0) + filesChanged,
      total_hours_to_merge: (stats.total_hours_to_merge ?? 0) + hoursToMerge,
    };
  }
}
