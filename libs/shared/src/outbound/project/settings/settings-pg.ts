import { enforceTrue } from "../../../lib/enforce.js";
import { selectList, fromRow } from "../../../lib/row.js";
import { REPO_COLUMNS } from "../../../domain/models/repo.js";
import type { PgPool } from "../../memory-store.js";
import { runInTransaction } from "../../db/pg-transaction.js";
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

/** The repo-config writes the settings adapter delegates to (the GitHub adapter). */
export interface RepoConfigWriter {
  setRepoVariable(repo: string, name: string, value: string): Promise<void>;
  setRepoSecret(repo: string, name: string, value: string): Promise<void>;
}

interface RepoIdentityRow {
  id: string;
  full_name: string;
}

const LOCK_RENAME_ROWS_SQL =
  "SELECT id, full_name FROM lore.repos WHERE full_name = ANY($1) FOR UPDATE";

const RENAME_REPO_ROW_SQL =
  "UPDATE lore.repos SET owner = $2, name = $3, full_name = $4 WHERE id = $1";

const INHERIT_EMPTY_SETTINGS_SQL = `UPDATE lore.repos target
    SET settings = source.settings
   FROM lore.repos source
  WHERE source.id = $1 AND target.id = $2
    AND (target.settings IS NULL OR target.settings = '{}'::jsonb)`;

/** Cross-repo links are stored on both sides by name; each list naming the old repo is rewritten to the new one, without duplicating it. */
const REPOINT_CROSS_REPO_LINKS_SQL = `UPDATE lore.repos
    SET settings = jsonb_set(settings, '{cross_repo_repos}',
          (SELECT jsonb_agg(DISTINCT CASE WHEN link = to_jsonb($1::text)
                                          THEN to_jsonb($2::text) ELSE link END)
             FROM jsonb_array_elements(settings->'cross_repo_repos') AS link))
  WHERE settings->'cross_repo_repos' @> jsonb_build_array($1::text)`;

const MOVE_AGENT_DEFINITIONS_SQL = `UPDATE lore.agent_definitions moved
    SET project_id = $2
  WHERE moved.project_id = $1
    AND NOT EXISTS (SELECT 1 FROM lore.agent_definitions kept
                     WHERE kept.project_id = $2 AND kept.name = moved.name)`;

/** Inside an open transaction: locks both names' rows, then renames `from` in place or merges it into `to`. */
async function renameRepoRow(
  db: PgPool,
  from: string,
  to: string,
): Promise<RepoRenameOutcome> {
  const { rows } = await db.query<RepoIdentityRow>(LOCK_RENAME_ROWS_SQL, [
    [from, to],
  ]);
  const source = rows.find((row) => row.full_name === from);
  const target = rows.find((row) => row.full_name === to);

  if (!source) {
    return "absent";
  }
  const outcome = target
    ? await mergeRepoRows(db, source.id, target.id)
    : await renameRepoRowInPlace(db, source.id, to);

  await db.query(REPOINT_CROSS_REPO_LINKS_SQL, [from, to]);

  return outcome;
}

async function renameRepoRowInPlace(
  db: PgPool,
  id: string,
  to: string,
): Promise<RepoRenameOutcome> {
  const [owner, name] = to.split("/");

  await db.query(RENAME_REPO_ROW_SQL, [id, owner, name, to]);

  return "renamed";
}

/** The new row keeps its own definition where both rows define one name, and its own settings unless it has none; the old row's leftovers cascade with it. */
async function mergeRepoRows(
  db: PgPool,
  sourceId: string,
  targetId: string,
): Promise<RepoRenameOutcome> {
  await db.query(MOVE_AGENT_DEFINITIONS_SQL, [sourceId, targetId]);
  await db.query(INHERIT_EMPTY_SETTINGS_SQL, [sourceId, targetId]);
  await db.query("DELETE FROM lore.repos WHERE id = $1", [sourceId]);

  return "merged";
}

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

  async resolve(repo: string): Promise<ResolvedDarkFactorySettings> {
    const { rows } = await this.pool.query(
      "SELECT settings FROM lore.repos WHERE full_name = $1",
      [repo],
    );
    const settings = rows[0]?.settings as
      { dark_factory?: DarkFactorySettings } | undefined;

    return resolveDarkFactorySettings(settings?.dark_factory);
  }

  async resolveOrNull(
    repo: string,
  ): Promise<ResolvedDarkFactorySettings | null> {
    const { rows } = await this.pool.query(
      "SELECT settings FROM lore.repos WHERE full_name = $1",
      [repo],
    );

    if (rows.length === 0) {
      return null;
    }
    const settings = rows[0]?.settings as
      { dark_factory?: DarkFactorySettings } | undefined;

    return resolveDarkFactorySettings(settings?.dark_factory);
  }

  setRepoVariable(repo: string, name: string, value: string): Promise<void> {
    return this.writer().setRepoVariable(repo, name, value);
  }

  setRepoSecret(repo: string, name: string, value: string): Promise<void> {
    return this.writer().setRepoSecret(repo, name, value);
  }

  async record(repo: string): Promise<RepoRecord | null> {
    const { rows } = await this.pool.query<Record<string, unknown>>(
      `SELECT ${selectList(REPO_COLUMNS)} FROM lore.repos WHERE full_name = $1`,
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
      "SELECT full_name, last_ingested_at FROM lore.repos WHERE onboarding_pr_merged = true",
    );

    return rows as OnboardedRepo[];
  }

  async allRepos(): Promise<string[]> {
    const { rows } = await this.pool.query<{ full_name: string }>(
      "SELECT full_name FROM lore.repos ORDER BY full_name",
    );

    return rows.map((r) => r.full_name);
  }

  async isOnboarded(repo: string): Promise<boolean> {
    const { rows } = await this.pool.query(
      "SELECT 1 FROM lore.repos WHERE full_name = $1 AND onboarding_pr_merged = true",
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
