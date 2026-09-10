import { selectList, fromRow, type DbRow } from "../../../lib/row.js";
import {
  GITHUB_INSTALLATION_COLUMNS,
  GITHUB_INSTALLATION_TABLE,
  type GithubInstallation,
} from "../../../domain/models/github-installation.js";
import type { PgPool } from "../../memory-store.js";
import type {
  GithubInstallationsRepository,
  UpsertGithubInstallationInput,
} from "./github-installations-port.js";

// installed_at is written on insert only: a refresh keeps when the account first installed the App.
const UPSERT_SQL = `INSERT INTO ${GITHUB_INSTALLATION_TABLE}
     (installation_id, account_login, account_type, repository_selection,
      suspended_at, installed_at, updated_at)
   VALUES ($1, $2, $3, $4, $5, $6, $6)
   ON CONFLICT (installation_id) DO UPDATE SET
     account_login = EXCLUDED.account_login,
     account_type = EXCLUDED.account_type,
     repository_selection = EXCLUDED.repository_selection,
     suspended_at = EXCLUDED.suspended_at,
     updated_at = EXCLUDED.updated_at
   RETURNING ${selectList(GITHUB_INSTALLATION_COLUMNS)}`;

/** The upsert's parameters, in the order `UPSERT_SQL` binds them; `at` is both installed_at and updated_at. */
function upsertParams(
  input: UpsertGithubInstallationInput,
  at: Date,
): unknown[] {
  return [
    input.installationId,
    input.accountLogin,
    input.accountType,
    input.repositorySelection,
    input.suspendedAt,
    at,
  ];
}

/** Postgres-backed {@link GithubInstallationsRepository}. Times come from the injected clock rather than `now()`, so this and the in-memory spec stamp the same instants. */
export class PgGithubInstallations implements GithubInstallationsRepository {
  constructor(
    private readonly pool: PgPool,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async upsert(
    input: UpsertGithubInstallationInput,
  ): Promise<GithubInstallation> {
    const { rows } = await this.pool.query<DbRow>(
      UPSERT_SQL,
      upsertParams(input, this.now()),
    );

    return fromRow<GithubInstallation>(GITHUB_INSTALLATION_COLUMNS, rows[0]);
  }

  async findByAccount(
    accountLogin: string,
  ): Promise<GithubInstallation | null> {
    const { rows } = await this.pool.query<DbRow>(
      `SELECT ${selectList(GITHUB_INSTALLATION_COLUMNS)}
         FROM ${GITHUB_INSTALLATION_TABLE}
        WHERE lower(account_login) = lower($1)`,
      [accountLogin],
    );

    return rows[0]
      ? fromRow<GithubInstallation>(GITHUB_INSTALLATION_COLUMNS, rows[0])
      : null;
  }

  async remove(installationId: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM ${GITHUB_INSTALLATION_TABLE} WHERE installation_id = $1`,
      [installationId],
    );
  }

  async list(): Promise<GithubInstallation[]> {
    const { rows } = await this.pool.query<DbRow>(
      `SELECT ${selectList(GITHUB_INSTALLATION_COLUMNS)}
         FROM ${GITHUB_INSTALLATION_TABLE}
        ORDER BY account_login`,
    );

    return rows.map((row) =>
      fromRow<GithubInstallation>(GITHUB_INSTALLATION_COLUMNS, row),
    );
  }
}
