import type { LoopKey } from "../../../domain/loops/loop-kinds.js";
import type { LoopPause } from "../../../domain/loops/loop-pause.js";
import type {
  SettingsPort,
  OnboardedRepo,
  OnboardedRepoSettings,
  PendingOnboardingRepo,
  RepoRecord,
  RepoRenameOutcome,
  WorkflowState,
} from "./settings-port.js";
import { isMirror, mirrorNameOf } from "./seeded-mirror.js";
import { toRepoRecord } from "./seeded-repo.js";

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
  onboarded_at?: Date | null;
}

function pausesOf(
  settings: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const pauses = settings?.loop_pauses;

  return typeof pauses === "object" && pauses !== null
    ? (pauses as Record<string, unknown>)
    : {};
}

function hasSettings(settings: SeedRepo["settings"]): boolean {
  return Boolean(settings) && Object.keys(settings ?? {}).length > 0;
}

/** In-memory SettingsPort double; var/secret writes captured in {@link vars}/{@link secrets}. */
export class InMemorySettings implements SettingsPort {
  readonly vars: Array<{ repo: string; name: string; value: string }> = [];
  readonly secrets: Array<{ repo: string; name: string; value: string }> = [];

  /** Workflow states keyed `<repo>/<file>`, seeded by a test; an unseeded workflow is `missing`, and enabling one makes it `active`. */
  readonly workflowStates = new Map<string, WorkflowState>();
  readonly enabledWorkflows: Array<{ repo: string; file: string }> = [];
  readonly dispatchedWorkflows: Array<{
    repo: string;
    file: string;
    ref: string;
  }> = [];

  /** Org-wide settings by key, seeded by a test that reads one. */
  readonly org: Record<string, string> = {};

  constructor(public readonly repos: SeedRepo[] = []) {}

  async orgSetting(key: string): Promise<string | null> {
    return this.org[key] ?? null;
  }

  private row(repo: string): SeedRepo | undefined {
    return this.repos.find((r) => r.full_name === repo);
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

  async workflowState(repo: string, file: string): Promise<WorkflowState> {
    return this.workflowStates.get(`${repo}/${file}`) ?? "missing";
  }

  async enableWorkflow(repo: string, file: string): Promise<void> {
    this.enabledWorkflows.push({ repo, file });
    this.workflowStates.set(`${repo}/${file}`, "active");
  }

  async dispatchWorkflow(
    repo: string,
    file: string,
    ref: string,
  ): Promise<void> {
    this.dispatchedWorkflows.push({ repo, file, ref });
  }

  // Case-insensitive, mirroring PgSettings.record: the lookup web-ui's repo layout uses to find the canonical casing of a wrong-case URL.
  async record(repo: string): Promise<RepoRecord | null> {
    const row = this.repos.find(
      (r) => r.full_name.toLowerCase() === repo.toLowerCase(),
    );

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

  async mirrorOwner(name: string): Promise<string | null> {
    const owner = this.repos.find(
      (repo) =>
        mirrorNameOf(repo.settings)?.toLowerCase() === name.toLowerCase(),
    );

    return owner?.full_name ?? null;
  }

  async pauseLoop(repo: string, key: LoopKey, pause: LoopPause): Promise<void> {
    const row = this.row(repo);

    if (row) {
      row.settings = {
        ...row.settings,
        loop_pauses: { ...pausesOf(row.settings), [key]: pause },
      };
    }
  }

  async resumeLoop(repo: string, key: LoopKey): Promise<void> {
    const row = this.row(repo);

    if (row?.settings) {
      const { [key]: _resumed, ...kept } = pausesOf(row.settings);

      row.settings = { ...row.settings, loop_pauses: kept };
    }
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

  private onboardedRows(): SeedRepo[] {
    return this.repos.filter(
      (r) => r.onboarding_pr_merged === true && !isMirror(this.repos, r),
    );
  }

  async onboardedRepos(): Promise<OnboardedRepo[]> {
    return this.onboardedRows().map((r) => ({
      full_name: r.full_name,
      last_ingested_at: r.last_ingested_at ?? null,
    }));
  }

  async onboardedRepoSettings(): Promise<OnboardedRepoSettings[]> {
    return this.onboardedRows().map((r) => ({
      full_name: r.full_name,
      settings: (r.settings ?? null) as OnboardedRepoSettings["settings"],
    }));
  }

  async allRepos(): Promise<string[]> {
    return this.repos
      .filter((r) => !isMirror(this.repos, r))
      .map((r) => r.full_name);
  }

  async isOnboarded(repo: string): Promise<boolean> {
    return this.repos.some(
      (r) =>
        r.full_name === repo &&
        r.onboarding_pr_merged === true &&
        !isMirror(this.repos, r),
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
        (r) =>
          r.onboarding_pr_merged !== true &&
          r.onboarding_pr_url != null &&
          !isMirror(this.repos, r),
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

    this.repointPublicMirror(from, to);

    if (!source) {
      return "absent";
    }
    const outcome = target
      ? this.mergeRepoRows(source, target)
      : this.renameRowInPlace(source, to);

    this.repointCrossRepoLinks(from, to);

    return outcome;
  }

  private repointPublicMirror(from: string, to: string): void {
    for (const repo of this.repos) {
      if (mirrorNameOf(repo.settings)?.toLowerCase() === from.toLowerCase()) {
        repo.settings = { ...repo.settings, public_mirror: to };
      }
    }
  }

  private renameRowInPlace(source: SeedRepo, to: string): RepoRenameOutcome {
    source.full_name = to;

    return "renamed";
  }

  private mergeRepoRows(source: SeedRepo, target: SeedRepo): RepoRenameOutcome {
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
