// The Utopia knowledge base of each base by name (lore.utopia_bases): a repo's full name, or the org memory base's name, which has no repo row to keep settings in.

import type { Pool } from "pg";
import type { UtopiaMirrorSettings } from "@re-cinq/lore-shared/models/repo-settings.js";

/** One row per base, matched without regard to case, so a re-run of setup overwrites the knowledge base it holds. */
export async function saveUtopiaBase(
  pool: Pool,
  name: string,
  kbId: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO lore.utopia_bases (name, kb_id) VALUES ($1, $2)
     ON CONFLICT ((lower(name))) DO UPDATE SET kb_id = EXCLUDED.kb_id, updated_at = now()`,
    [name, kbId],
  );
}

export async function utopiaBaseFor(
  pool: Pool,
  name: string,
): Promise<string | null> {
  const { rows } = await pool.query<{ kb_id: string }>(
    "SELECT kb_id FROM lore.utopia_bases WHERE lower(name) = lower($1)",
    [name],
  );

  return rows.at(0)?.kb_id ?? null;
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

/** The commit mirror's cursor alone, set inside the utopia block so the knowledge base and ontology version beside it stay as they are. */
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
