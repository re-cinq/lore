import { randomUUID } from "node:crypto";
import {
  resolveDarkFactorySettings,
  type DarkFactorySettings,
  type ResolvedDarkFactorySettings,
} from "../../../domain/dark-factory-settings.js";
import type {
  SettingsPort,
  OnboardedRepo,
  PendingOnboardingRepo,
  RepoRecord,
  RepoRenameOutcome,
} from "./settings-port.js";

/** A seeded `lore.repos` row for the in-memory settings double. */
function hasSettings(settings: SeedRepo["settings"]): boolean {
  return Boolean(settings) && Object.keys(settings ?? {}).length > 0;
}

export interface SeedRepo {
  id?: string;
  onboarding_pr_url?: string | null;
  outcome_stats?: Record<string, number> | null;
  full_name: string;
  team?: string | null;
  settings?: Record<string, unknown> | null;
  last_ingested_at?: Date | null;
  onboarding_pr_merged?: boolean;
  onboarded_at?: Date | null;
  /** Names of the per-repo `lore.agent_definitions` rows keyed to this repo's id. */
  agent_definitions?: string[];
}

function toRepoRecord(row: SeedRepo): RepoRecord {
  return {
    ...repoIdentity(row),
    ...repoMeta(row),
    ...repoOnboarding(row),
    ...repoExtras(row),
  };
}

function repoIdentity(
  row: SeedRepo,
): Pick<RepoRecord, "id" | "owner" | "name" | "fullName"> {
  const [owner, name] = repoNameParts(row.full_name);

  return { id: row.id ?? randomUUID(), owner, name, fullName: row.full_name };
}

function repoNameParts(fullName: string): [string, string] {
  const [owner = "", name = ""] = fullName.split("/");

  return [owner, name];
}

function repoMeta(
  row: SeedRepo,
): Pick<RepoRecord, "team" | "onboardedAt" | "lastIngestedAt"> {
  return {
    team: row.team ?? null,
    onboardedAt: row.onboarded_at ?? new Date(0),
    lastIngestedAt: row.last_ingested_at ?? null,
  };
}

function repoOnboarding(
  row: SeedRepo,
): Pick<RepoRecord, "onboardingPrUrl" | "onboardingPrMerged"> {
  return {
    onboardingPrUrl: row.onboarding_pr_url ?? null,
    onboardingPrMerged: row.onboarding_pr_merged ?? false,
  };
}

function repoExtras(
  row: SeedRepo,
): Pick<RepoRecord, "settings" | "outcomeStats"> {
  return {
    settings: row.settings ?? null,
    outcomeStats: row.outcome_stats ?? null,
  };
}

/** In-memory SettingsPort double; var/secret writes captured in {@link vars}/{@link secrets}. */
export class InMemorySettings implements SettingsPort {
  readonly vars: Array<{ repo: string; name: string; value: string }> = [];
  readonly secrets: Array<{ repo: string; name: string; value: string }> = [];

  constructor(public readonly repos: SeedRepo[] = []) {}

  private row(repo: string): SeedRepo | undefined {
    return this.repos.find((r) => r.full_name === repo);
  }

  async resolve(repo: string): Promise<ResolvedDarkFactorySettings> {
    return resolveDarkFactorySettings(this.darkFactory(repo));
  }

  async resolveOrNull(
    repo: string,
  ): Promise<ResolvedDarkFactorySettings | null> {
    if (!this.row(repo)) {
      return null;
    }

    return resolveDarkFactorySettings(this.darkFactory(repo));
  }

  private darkFactory(repo: string): DarkFactorySettings | undefined {
    const settings = this.row(repo)?.settings as
      { dark_factory?: DarkFactorySettings } | undefined;

    return settings?.dark_factory;
  }

  async setRepoVariable(
    repo: string,
    name: string,
    value: string,
  ): Promise<void> {
    this.vars.push({ repo, name, value });
  }

  async setRepoSecret(
    repo: string,
    name: string,
    value: string,
  ): Promise<void> {
    this.secrets.push({ repo, name, value });
  }

  async record(repo: string): Promise<RepoRecord | null> {
    const row = this.row(repo);

    if (!row) {
      return null;
    }

    return toRepoRecord(row);
  }

  async rawSettings(repo: string): Promise<Record<string, unknown> | null> {
    const row = this.row(repo);

    if (!row) {
      return null;
    }

    return row.settings ?? null;
  }

  async updateSettings(
    repo: string,
    settings: Record<string, unknown>,
  ): Promise<void> {
    const row = this.row(repo);

    if (row) {
      row.settings = settings;

      return;
    }
    this.repos.push({ full_name: repo, settings });
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
      .map((r) => ({
        full_name: r.full_name,
        last_ingested_at: r.last_ingested_at ?? null,
      }));
  }

  async allRepos(): Promise<string[]> {
    return this.repos.map((r) => r.full_name);
  }

  async isOnboarded(repo: string): Promise<boolean> {
    return this.repos.some(
      (r) => r.full_name === repo && r.onboarding_pr_merged === true,
    );
  }

  async markIngested(repo: string): Promise<void> {
    const row = this.row(repo);

    if (row) {
      row.last_ingested_at = new Date();
    }
  }

  async pendingOnboardingRepos(): Promise<PendingOnboardingRepo[]> {
    return this.repos
      .filter(
        (r) => r.onboarding_pr_merged !== true && r.onboarding_pr_url != null,
      )
      .map((r) => ({
        id: r.id ?? "",
        full_name: r.full_name,
        onboarding_pr_url: r.onboarding_pr_url as string,
      }));
  }

  async markOnboardingMergedById(id: string): Promise<void> {
    const row = this.repos.find((r) => r.id === id);

    if (row) {
      row.onboarding_pr_merged = true;
    }
  }

  async clearOnboardingPrUrl(id: string): Promise<void> {
    const row = this.repos.find((r) => r.id === id);

    if (row) {
      row.onboarding_pr_url = null;
    }
  }

  async setOnboardingPrUrl(repo: string, url: string): Promise<void> {
    const row = this.row(repo);

    if (row) {
      row.onboarding_pr_url = url;

      return;
    }
    this.repos.push({ full_name: repo, onboarding_pr_url: url });
  }

  async renameRepo(from: string, to: string): Promise<RepoRenameOutcome> {
    const source = this.row(from);
    const target = this.row(to);

    if (!source) {
      return "absent";
    }
    const outcome = target
      ? this.mergeRepoRows(source, target)
      : this.renameRowInPlace(source, to);

    this.repointCrossRepoLinks(from, to);

    return outcome;
  }

  private renameRowInPlace(source: SeedRepo, to: string): RepoRenameOutcome {
    source.full_name = to;

    return "renamed";
  }

  private mergeRepoRows(source: SeedRepo, target: SeedRepo): RepoRenameOutcome {
    const targetNames = target.agent_definitions ?? [];
    const moved = (source.agent_definitions ?? []).filter(
      (name) => !targetNames.includes(name),
    );

    target.agent_definitions = [...targetNames, ...moved];
    target.settings = hasSettings(target.settings)
      ? target.settings
      : source.settings;
    this.repos.splice(this.repos.indexOf(source), 1);

    return "merged";
  }

  /** Cross-repo links are stored on both sides by name, so every list naming the old repo is pointed at the new one. */
  private repointCrossRepoLinks(from: string, to: string): void {
    for (const repo of this.repos) {
      const links = repo.settings?.cross_repo_repos;

      if (Array.isArray(links) && links.includes(from)) {
        repo.settings = {
          ...repo.settings,
          cross_repo_repos: [
            ...new Set(links.map((link) => (link === from ? to : link))),
          ],
        };
      }
    }
  }

  async bumpOutcomeStats(
    repo: string,
    filesChanged: number,
    hoursToMerge: number,
  ): Promise<void> {
    const row = this.row(repo);

    if (!row) {
      return;
    }
    const stats: Record<string, number | undefined> = row.outcome_stats ?? {};

    row.outcome_stats = {
      ...stats,
      merged_count: (stats.merged_count ?? 0) + 1,
      total_files_changed: (stats.total_files_changed ?? 0) + filesChanged,
      total_hours_to_merge: (stats.total_hours_to_merge ?? 0) + hoursToMerge,
    };
  }
}
