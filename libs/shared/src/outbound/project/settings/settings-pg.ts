import { enforceTrue } from "../../../lib/enforce.js";
import type { LoopKey } from "../../../domain/loops/loop-kinds.js";
import type { LoopPause } from "../../../domain/loops/loop-pause.js";
import { NOT_A_MIRROR_SQL, storedBlock } from "./settings-sql.js";
import { selectList, fromRow } from "../../../lib/row.js";
import { REPO_COLUMNS } from "../../../domain/models/repo.js";
import type { PgPool } from "../../memory-store.js";
import {
  moveRepoKnowledge,
  type KnowledgeMoveCount,
  type KnowledgeMoveOptions,
} from "./repo-move.js";
import { absorbMirrorRow } from "./repo-move-row.js";
import { renameRepoRow } from "./repo-rename.js";
import { runInTransaction } from "../../db/pg-transaction.js";
import type {
  SettingsPort,
  OnboardedRepo,
  OnboardedRepoSettings,
  PendingOnboardingRepo,
  RepoRecord,
  RepoRenameOutcome,
  WorkflowState,
} from "./settings-port.js";

/** The repo-config writes the settings adapter delegates to (the GitHub adapter). */
export type RepoConfigWriter = Pick<
  SettingsPort,
  | "setRepoVariable"
  | "setRepoSecret"
  | "workflowState"
  | "enableWorkflow"
  | "dispatchWorkflow"
>;

/** Reads lore.repos.settings JSONB; delegates var/secret writes to GitHub adapter. */
export class PgSettings implements SettingsPort {
  constructor(
    private readonly pool: PgPool,
    private readonly repoConfig?: RepoConfigWriter,
  ) {}

  private writer(): RepoConfigWriter {
    enforceTrue(
      this.repoConfig,
      Error,
      "PgSettings: repo-config writer not provided (read-only binding)",
    );

    return this.repoConfig;
  }

  async orgSetting(key: string): Promise<string | null> {
    const { rows } = await this.pool.query<{ value: string }>(
      "SELECT value FROM lore.settings WHERE key = $1",
      [key],
    );

    return rows[0]?.value ?? null;
  }

  setRepoVariable(repo: string, name: string, value: string): Promise<void> {
    return this.writer().setRepoVariable(repo, name, value);
  }

  setRepoSecret(repo: string, name: string, value: string): Promise<void> {
    return this.writer().setRepoSecret(repo, name, value);
  }

  workflowState(repo: string, file: string): Promise<WorkflowState> {
    return this.writer().workflowState(repo, file);
  }

  enableWorkflow(repo: string, file: string): Promise<void> {
    return this.writer().enableWorkflow(repo, file);
  }

  dispatchWorkflow(repo: string, file: string, ref: string): Promise<void> {
    return this.writer().dispatchWorkflow(repo, file, ref);
  }

  // Case-insensitive: the one lookup web-ui's repo layout uses to find the canonical casing of a URL typed or bookmarked with the wrong case.
  async record(repo: string): Promise<RepoRecord | null> {
    const { rows } = await this.pool.query<Record<string, unknown>>(
      `SELECT ${selectList(REPO_COLUMNS)} FROM lore.repos WHERE LOWER(full_name) = LOWER($1)`,
      [repo],
    );

    return rows[0] ? fromRow<RepoRecord>(REPO_COLUMNS, rows[0]) : null;
  }

  async rawSettings(repo: string): Promise<Record<string, unknown> | null> {
    const { rows } = await this.pool.query(
      "SELECT settings FROM lore.repos WHERE full_name = $1",
      [repo],
    );

    if (rows.length === 0) {
      return null;
    }

    return (rows[0]?.settings as Record<string, unknown> | null) ?? null;
  }

  async updateSettings(
    repo: string,
    settings: Record<string, unknown>,
  ): Promise<void> {
    await this.pool.query(
      "UPDATE lore.repos SET settings = $1 WHERE full_name = $2",
      [JSON.stringify(settings), repo],
    );
  }

  async mirrorOwner(name: string): Promise<string | null> {
    const { rows } = await this.pool.query<{ full_name: string }>(
      "SELECT full_name FROM lore.repos WHERE lower(settings->>'public_mirror') = lower($1) LIMIT 1",
      [name],
    );

    return rows[0]?.full_name ?? null;
  }

  async pauseLoop(repo: string, key: LoopKey, pause: LoopPause): Promise<void> {
    await this.pool.query(
      `UPDATE lore.repos
          SET settings = (CASE WHEN jsonb_typeof(settings) = 'object' THEN settings ELSE '{}'::jsonb END)
            || jsonb_build_object('loop_pauses',
                 ${storedBlock("loop_pauses")} || jsonb_build_object($2::text, $3::jsonb))
        WHERE full_name = $1`,
      [repo, key, JSON.stringify(pause)],
    );
  }

  async resumeLoop(repo: string, key: LoopKey): Promise<void> {
    await this.pool.query(
      "UPDATE lore.repos SET settings = settings #- ARRAY['loop_pauses', $2::text] WHERE full_name = $1",
      [repo, key],
    );
  }

  async team(repo: string): Promise<string | null> {
    const { rows } = await this.pool.query(
      "SELECT team FROM lore.repos WHERE full_name = $1",
      [repo],
    );

    return (rows[0]?.team as string | undefined) ?? null;
  }

  async repoForTeam(team: string): Promise<string | null> {
    const { rows } = await this.pool.query(
      "SELECT full_name FROM lore.repos WHERE team = $1 LIMIT 1",
      [team],
    );

    return (rows[0]?.full_name as string | undefined) ?? null;
  }

  async onboardedRepos(): Promise<OnboardedRepo[]> {
    const { rows } = await this.pool.query<OnboardedRepo>(
      `SELECT full_name, last_ingested_at FROM lore.repos WHERE onboarding_pr_merged = true AND ${NOT_A_MIRROR_SQL}`,
    );

    return rows as OnboardedRepo[];
  }

  async onboardedRepoSettings(): Promise<OnboardedRepoSettings[]> {
    const { rows } = await this.pool.query<OnboardedRepoSettings>(
      `SELECT full_name, settings FROM lore.repos WHERE onboarding_pr_merged = true AND ${NOT_A_MIRROR_SQL} ORDER BY full_name`,
    );

    return rows;
  }

  async allRepos(): Promise<string[]> {
    const { rows } = await this.pool.query<{ full_name: string }>(
      `SELECT full_name FROM lore.repos WHERE ${NOT_A_MIRROR_SQL} ORDER BY full_name`,
    );

    return rows.map((r) => r.full_name);
  }

  async isOnboarded(repo: string): Promise<boolean> {
    const { rows } = await this.pool.query(
      `SELECT 1 FROM lore.repos WHERE full_name = $1 AND onboarding_pr_merged = true AND ${NOT_A_MIRROR_SQL}`,
      [repo],
    );

    return rows.length > 0;
  }

  async markIngested(repo: string): Promise<void> {
    await this.pool.query(
      "UPDATE lore.repos SET last_ingested_at = now() WHERE full_name = $1",
      [repo],
    );
  }

  async pendingOnboardingRepos(): Promise<PendingOnboardingRepo[]> {
    const { rows } = await this.pool.query<PendingOnboardingRepo>(
      `SELECT id, full_name, onboarding_pr_url
         FROM lore.repos
        WHERE onboarding_pr_merged = false
          AND onboarding_pr_url IS NOT NULL
          AND ${NOT_A_MIRROR_SQL}`,
    );

    return rows as PendingOnboardingRepo[];
  }

  async markOnboardingMergedById(id: string): Promise<void> {
    await this.pool.query(
      `UPDATE lore.repos
          SET onboarding_pr_merged = true
        WHERE id = $1`,
      [id],
    );
  }

  async clearOnboardingPrUrl(id: string): Promise<void> {
    await this.pool.query(
      "UPDATE lore.repos SET onboarding_pr_url = NULL WHERE id = $1",
      [id],
    );
  }

  async setOnboardingPrUrl(repo: string, url: string): Promise<void> {
    await this.pool.query(
      "UPDATE lore.repos SET onboarding_pr_url = $1 WHERE full_name = $2",
      [url, repo],
    );
  }

  moveKnowledge(
    mirror: string,
    privateRepo: string,
    options: KnowledgeMoveOptions,
  ): Promise<KnowledgeMoveCount[]> {
    return moveRepoKnowledge(this.pool, mirror, privateRepo, options);
  }

  absorbMirrorRow(mirror: string, privateRepo: string): Promise<void> {
    return runInTransaction(this.pool, (tx) =>
      absorbMirrorRow(tx, mirror, privateRepo),
    );
  }

  renameRepo(from: string, to: string): Promise<RepoRenameOutcome> {
    return runInTransaction(this.pool, (db) => renameRepoRow(db, from, to));
  }

  async bumpOutcomeStats(
    repo: string,
    filesChanged: number,
    hoursToMerge: number,
  ): Promise<void> {
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
