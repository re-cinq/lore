import { query } from "../platform/db.js";

export interface EpisodeInsert {
  agentId: string;
  content: string;
  contentHash: string;
  source: string;
  ref: string;
}

export interface EpisodeRepository {
  /** Inserts an episode; returns its id, or null when the
   * `(agent_id, content_hash)` pair already exists (dedup). */
  insert(episode: EpisodeInsert): Promise<string | null>;
}

export class PgEpisodeRepository implements EpisodeRepository {
  async insert(episode: EpisodeInsert): Promise<string | null> {
    const rows = await query<{ id: string }>(
      `INSERT INTO memory.episodes (agent_id, content, content_hash, source, ref)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (agent_id, content_hash) DO NOTHING
       RETURNING id`,
      [episode.agentId, episode.content, episode.contentHash, episode.source, episode.ref],
    );
    return rows[0]?.id || null;
  }
}

/** In-memory test double: dedups on `agentId` + `contentHash` like the
 * unique index, handing back a deterministic synthetic id. */
export class InMemoryEpisodeRepository implements EpisodeRepository {
  readonly rows: Array<EpisodeInsert & { id: string }> = [];

  async insert(episode: EpisodeInsert): Promise<string | null> {
    const dup = this.rows.some(
      (r) => r.agentId === episode.agentId && r.contentHash === episode.contentHash,
    );
    if (dup) return null;
    const id = `episode-${this.rows.length + 1}`;
    this.rows.push({ ...episode, id });
    return id;
  }
}
