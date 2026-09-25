import type { PgPool } from "../../memory-store.js";
import type {
  DigestClaim,
  DigestFinish,
  DigestPostsPort,
  DigestTexts,
} from "./digest-posts-port.js";

/** Postgres-backed DigestPostsPort over `lore.digest_posts`; a finished row is one with a thread_ts. */
export class PgDigestPosts implements DigestPostsPort {
  constructor(private readonly pool: PgPool) {}

  async lastPostedAt(repo: string): Promise<Date | null> {
    const { rows } = await this.pool.query<{ posted_at: Date }>(
      `SELECT posted_at FROM lore.digest_posts
        WHERE repo = $1 AND thread_ts <> ''
        ORDER BY posted_at DESC LIMIT 1`,
      [repo],
    );

    return rows[0]?.posted_at ?? null;
  }

  async threadFor(
    channelId: string,
    weekKey: string,
  ): Promise<{ threadTs: string } | null> {
    const { rows } = await this.pool.query<{ thread_ts: string }>(
      `SELECT thread_ts FROM lore.digest_posts
        WHERE channel_id = $1 AND week_key = $2 AND thread_ts <> ''
        ORDER BY posted_at DESC LIMIT 1`,
      [channelId, weekKey],
    );

    return rows[0] ? { threadTs: rows[0].thread_ts } : null;
  }

  async recentTexts(channelId: string, limit: number): Promise<DigestTexts[]> {
    const { rows } = await this.pool.query<DigestTexts>(
      `SELECT min(intro) AS intro, min(ending) AS ending
         FROM lore.digest_posts
        WHERE channel_id = $1 AND thread_ts <> ''
        GROUP BY run_id
        ORDER BY max(posted_at) DESC
        LIMIT $2`,
      [channelId, limit],
    );

    return rows;
  }

  async claim(runId: string, entries: DigestClaim[]): Promise<boolean> {
    const { rows } = await this.pool.query<{ run_id: string }>(
      `INSERT INTO lore.digest_posts (run_id, repo, channel_id, week_key)
       SELECT $1, repo, channel_id, week_key
         FROM jsonb_to_recordset($2::jsonb) AS e(repo TEXT, channel_id TEXT, week_key TEXT)
       ON CONFLICT DO NOTHING
       RETURNING run_id`,
      [
        runId,
        JSON.stringify(
          entries.map(({ repo, channelId, weekKey }) => ({
            repo,
            channel_id: channelId,
            week_key: weekKey,
          })),
        ),
      ],
    );

    return rows.length > 0;
  }

  async finish(runId: string, result: DigestFinish): Promise<void> {
    await this.pool.query(
      `UPDATE lore.digest_posts
          SET thread_ts = $2, intro = $3, ending = $4, posted_at = now()
        WHERE run_id = $1`,
      [runId, result.threadTs, result.intro, result.ending],
    );
  }

  async release(runId: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM lore.digest_posts WHERE run_id = $1 AND thread_ts = ''`,
      [runId],
    );
  }
}
