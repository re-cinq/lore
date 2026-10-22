// The Utopia push source of each repo (lore.utopia_sources): its key is a credential, so it is kept apart from lore.repos.settings, which read-scope routes serve whole, and no route ever answers it.

import type { Pool } from "pg";
import type { UtopiaMirrorSettings } from "@re-cinq/lore-shared/models/repo-settings.js";
import type { UtopiaSource } from "@re-cinq/lore-shared/utopia/utopia-client.js";

export interface SavedUtopiaSource {
  repo: string;
  kbId: string;
  sourceId: string;
  key: string;
}

/** One row per repo, matched without regard to case, so a re-run of setup overwrites the key it holds. */
export async function saveUtopiaSource(
  pool: Pool,
  source: SavedUtopiaSource,
): Promise<void> {
  await pool.query(
    `INSERT INTO lore.utopia_sources (repo, kb_id, source_id, source_key)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT ((lower(repo))) DO UPDATE
       SET kb_id = EXCLUDED.kb_id, source_id = EXCLUDED.source_id,
           source_key = EXCLUDED.source_key, updated_at = now()`,
    [source.repo, source.kbId, source.sourceId, source.key],
  );
}

/** A source and the knowledge base it belongs to, so setup keeps a key only for the knowledge base it finds. */
export interface StoredUtopiaSource extends UtopiaSource {
  kbId: string;
}

export async function utopiaSourceFor(
  pool: Pool,
  repo: string,
): Promise<StoredUtopiaSource | null> {
  const { rows } = await pool.query<{
    kb_id: string;
    source_id: string;
    source_key: string;
  }>(
    "SELECT kb_id, source_id, source_key FROM lore.utopia_sources WHERE lower(repo) = lower($1)",
    [repo],
  );
  const row = rows.at(0);

  return row
    ? { id: row.source_id, key: row.source_key, kbId: row.kb_id }
    : null;
}

/** Merged at both levels, not replaced: the settings block carries everything else the repo was configured with, and the utopia block carries the walks' cursors, which a setup or an ontology upgrade must not wipe. */
export async function saveUtopiaMirrorSettings(
  pool: Pool,
  repo: string,
  utopia: UtopiaMirrorSettings,
): Promise<void> {
  await pool.query(
    `UPDATE lore.repos
        SET settings = jsonb_set(COALESCE(settings, '{}'), '{utopia}', COALESCE(settings->'utopia', '{}') || $1::jsonb)
      WHERE full_name = $2`,
    [JSON.stringify(utopia), repo],
  );
}

/** The commit mirror's cursor alone, set inside the utopia block so the knowledge base, source and ontology version beside it stay as they are. */
export function saveUtopiaCommitsHead(
  pool: Pool,
  repo: string,
  sha: string,
): Promise<void> {
  return saveUtopiaCursor(pool, repo, "commits_head", sha);
}

/** The tracker mirror's cursor alone, set as the commit mirror's is. */
export function saveUtopiaTrackerSince(
  pool: Pool,
  repo: string,
  since: string,
): Promise<void> {
  return saveUtopiaCursor(pool, repo, "tracker_since", since);
}

const WALK_CURSORS = ["commits_head", "tracker_since"];

/** Starts the commit and tracker walks over from the beginning: both cursors dropped, the rest of the `utopia` settings block kept. Answers the keys it dropped. */
export async function clearUtopiaCursors(
  pool: Pool,
  repo: string,
): Promise<string[]> {
  await pool.query(
    `UPDATE lore.repos SET settings = settings #- '{utopia,commits_head}' #- '{utopia,tracker_since}'
      WHERE full_name = $1 AND jsonb_typeof(settings -> 'utopia') = 'object'`,
    [repo],
  );

  return WALK_CURSORS;
}

/** The id of the repo's `docs` source, which context assembly reads documents from; it is no secret, unlike the source's key. */
export function saveUtopiaDocsSourceId(
  pool: Pool,
  repo: string,
  sourceId: string,
): Promise<void> {
  return saveUtopiaCursor(pool, repo, "docs_source_id", sourceId);
}

async function saveUtopiaCursor(
  pool: Pool,
  repo: string,
  key: "commits_head" | "tracker_since" | "docs_source_id",
  value: string,
): Promise<void> {
  await pool.query(
    `UPDATE lore.repos SET settings = jsonb_set(COALESCE(settings, '{}'), ARRAY['utopia', $3::text], to_jsonb($1::text)) WHERE full_name = $2`,
    [value, repo, key],
  );
}
