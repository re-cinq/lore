import {
  CHANGELOG_RELEASE_COLUMNS,
  CHANGELOG_RELEASE_TABLE,
  type ChangelogRelease,
} from "../../../domain/models/changelog-release.js";
import { fromRow, selectList, type DbRow } from "../../../lib/row.js";
import type { PgPool } from "../../memory-store.js";
import {
  type ChangelogReleasePageQuery,
  type ChangelogReleasesPort,
  latestRelease,
  type ChangelogReleaseWrite,
} from "./changelog-releases-port.js";

const writeParams = (release: ChangelogReleaseWrite) => [
  release.repo,
  release.version,
  release.previousTag,
  release.sha,
  release.bump,
  release.rangeFrom,
  release.rangeTo,
  release.summary,
  JSON.stringify(release.changes),
  release.releaseUrl,
  release.publishedTo,
];

export class PgChangelogReleases implements ChangelogReleasesPort {
  constructor(private readonly pool: PgPool) {}

  async upsert(release: ChangelogReleaseWrite) {
    await this.pool.query(
      `INSERT INTO ${CHANGELOG_RELEASE_TABLE}
         (repo, version, previous_tag, sha, bump, range_from, range_to, summary,
          changes, release_url, published_to, written_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11,
               now())
       ON CONFLICT (repo, version) DO UPDATE
         SET previous_tag = EXCLUDED.previous_tag, sha = EXCLUDED.sha,
             bump = EXCLUDED.bump, range_from = EXCLUDED.range_from,
             range_to = EXCLUDED.range_to, summary = EXCLUDED.summary,
             changes = EXCLUDED.changes, release_url = EXCLUDED.release_url,
             published_to = EXCLUDED.published_to`,
      writeParams(release),
    );
  }

  async page(
    repo: string,
    { before, limit }: ChangelogReleasePageQuery,
  ): Promise<ChangelogRelease[]> {
    const { rows } = await this.pool.query<DbRow>(
      `SELECT ${selectList(CHANGELOG_RELEASE_COLUMNS)} FROM ${CHANGELOG_RELEASE_TABLE}
        WHERE repo = $1 AND ($2::timestamptz IS NULL OR range_to < $2)
        ORDER BY range_to DESC, version COLLATE "C" DESC
        LIMIT $3`,
      [repo, before ?? null, limit],
    );

    return rows.map((row) =>
      fromRow<ChangelogRelease>(CHANGELOG_RELEASE_COLUMNS, row),
    );
  }

  async latest(repo: string): Promise<ChangelogRelease | null> {
    return latestRelease(this, repo);
  }

  async claimAnnouncement(repo: string, version: string): Promise<boolean> {
    const { rows } = await this.pool.query<{ version: string }>(
      `UPDATE ${CHANGELOG_RELEASE_TABLE} SET announced_at = now()
        WHERE repo = $1 AND version = $2 AND announced_at IS NULL
        RETURNING version`,
      [repo, version],
    );

    return rows.length === 1;
  }
}
