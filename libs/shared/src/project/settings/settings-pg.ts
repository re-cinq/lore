import type { PgPool } from "../../memory-store.js";
import {
  resolveDarkFactorySettings,
  type DarkFactorySettings,
  type ResolvedDarkFactorySettings,
} from "../../dark-factory-settings.js";
import type { SettingsPort, OnboardedRepo, PendingOnboardingRepo } from "./settings-port.js";

/** The repo-config writes the settings adapter delegates to (the GitHub adapter). */
export interface RepoConfigWriter {
  setRepoVariable(repo: string, name: string, value: string): Promise<void>;
  setRepoSecret(repo: string, name: string, value: string): Promise<void>;
}

/**
 * SettingsPort.resolve over lore.repos.settings — reads the JSONB row and runs
 * the EXISTING resolveDarkFactorySettings (no resolution logic reimplemented).
 * Repo var/secret WRITES are GitHub-config, delegated to the injected writer
 * (the platform-github adapter; omitted for the org-wide read-only singleton).
 */
export class PgSettings implements SettingsPort {
  constructor(
    private readonly pool: PgPool,
    private readonly repoConfig?: RepoConfigWriter,
  ) {}

  private writer(): RepoConfigWriter {
    if (!this.repoConfig) {
      throw new Error("PgSettings: repo-config writer not provided (read-only binding)");
    }
    return this.repoConfig;
  }

  async resolve(repo: string): Promise<ResolvedDarkFactorySettings> {
    const { rows } = await this.pool.query("SELECT settings FROM lore.repos WHERE full_name = $1", [repo]);
    const settings = rows[0]?.settings as { dark_factory?: DarkFactorySettings } | undefined;
    return resolveDarkFactorySettings(settings?.dark_factory);
  }

  async resolveOrNull(repo: string): Promise<ResolvedDarkFactorySettings | null> {
    const { rows } = await this.pool.query("SELECT settings FROM lore.repos WHERE full_name = $1", [repo]);
    if (rows.length === 0) return null;
    const settings = rows[0]?.settings as { dark_factory?: DarkFactorySettings } | undefined;
    return resolveDarkFactorySettings(settings?.dark_factory);
  }

  setRepoVariable(repo: string, name: string, value: string): Promise<void> {
    return this.writer().setRepoVariable(repo, name, value);
  }

  setRepoSecret(repo: string, name: string, value: string): Promise<void> {
    return this.writer().setRepoSecret(repo, name, value);
  }

  async rawSettings(repo: string): Promise<Record<string, unknown> | null> {
    const { rows } = await this.pool.query("SELECT settings FROM lore.repos WHERE full_name = $1", [repo]);
    if (rows.length === 0) return null;
    return (rows[0]?.settings as Record<string, unknown> | null) ?? null;
  }

  async updateSettings(repo: string, settings: Record<string, unknown>): Promise<void> {
    await this.pool.query("UPDATE lore.repos SET settings = $1 WHERE full_name = $2", [
      JSON.stringify(settings),
      repo,
    ]);
  }

  async team(repo: string): Promise<string | null> {
    const { rows } = await this.pool.query("SELECT team FROM lore.repos WHERE full_name = $1", [repo]);
    return (rows[0]?.team as string | undefined) ?? null;
  }

  async repoForTeam(team: string): Promise<string | null> {
    const { rows } = await this.pool.query("SELECT full_name FROM lore.repos WHERE team = $1 LIMIT 1", [team]);
    return (rows[0]?.full_name as string | undefined) ?? null;
  }

  async onboardedRepos(): Promise<OnboardedRepo[]> {
    const { rows } = await this.pool.query(
      "SELECT full_name, last_ingested_at FROM lore.repos WHERE onboarding_pr_merged = true",
    );
    return rows as OnboardedRepo[];
  }

  async markIngested(repo: string): Promise<void> {
    await this.pool.query("UPDATE lore.repos SET last_ingested_at = now() WHERE full_name = $1", [repo]);
  }

  async pendingOnboardingRepos(): Promise<PendingOnboardingRepo[]> {
    const { rows } = await this.pool.query(
      `SELECT id, full_name, onboarding_pr_url
         FROM lore.repos
        WHERE onboarding_pr_merged = false
          AND onboarding_pr_url IS NOT NULL`,
    );
    return rows as PendingOnboardingRepo[];
  }

  async markOnboardingMergedById(id: string): Promise<void> {
    await this.pool.query(
      `UPDATE lore.repos
          SET onboarding_pr_merged = true, last_ingested_at = now()
        WHERE id = $1`,
      [id],
    );
  }

  async setOnboardingPrUrl(repo: string, url: string): Promise<void> {
    await this.pool.query("UPDATE lore.repos SET onboarding_pr_url = $1 WHERE full_name = $2", [url, repo]);
  }

  async bumpOutcomeStats(repo: string, filesChanged: number, hoursToMerge: number): Promise<void> {
    await this.pool.query(
      `UPDATE lore.repos SET outcome_stats = jsonb_set(
         jsonb_set(
           jsonb_set(COALESCE(outcome_stats, '{}'), '{merged_count}', to_jsonb(COALESCE((outcome_stats->>'merged_count')::int, 0) + 1)),
           '{total_files_changed}', to_jsonb(COALESCE((outcome_stats->>'total_files_changed')::int, 0) + $2)),
         '{total_hours_to_merge}', to_jsonb(COALESCE((outcome_stats->>'total_hours_to_merge')::int, 0) + $3))
       WHERE full_name = $1`,
      [repo, filesChanged, hoursToMerge],
    );
  }
}
