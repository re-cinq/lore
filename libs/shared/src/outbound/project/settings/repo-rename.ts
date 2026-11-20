import type { PgPool } from "../../memory-store.js";
import type { RepoRenameOutcome } from "./settings-port.js";

interface LockedRenameRow {
  id: string;
  full_name: string;
  mirrorName: string | null;
}

/** Locks the two named rows and the row whose public_mirror is either name, so a renamed public repo finds its private repo in the same read. */
const LOCK_RENAME_ROWS_SQL = `SELECT id, full_name, settings->>'public_mirror' AS "mirrorName"
    FROM lore.repos
   WHERE full_name = ANY($1)
      OR lower(settings->>'public_mirror') IN (SELECT lower(name) FROM unnest($1::text[]) AS name)
     FOR UPDATE`;

const REPOINT_PUBLIC_MIRROR_SQL =
  "UPDATE lore.repos SET settings = jsonb_set(settings, '{public_mirror}', to_jsonb($2::text)) WHERE id = $1";

const RENAME_REPO_ROW_SQL =
  "UPDATE lore.repos SET owner = $2, name = $3, full_name = $4 WHERE id = $1";

const INHERIT_EMPTY_SETTINGS_SQL = `UPDATE lore.repos target
    SET settings = source.settings
   FROM lore.repos source
  WHERE source.id = $1 AND target.id = $2
    AND (target.settings IS NULL OR target.settings = '{}'::jsonb)`;

/** Cross-repo links are stored on both sides by name; each list naming the old repo is rewritten to the new one, without duplicating it. */
export const REPOINT_CROSS_REPO_LINKS_SQL = `UPDATE lore.repos
    SET settings = jsonb_set(settings, '{cross_repo_repos}',
          (SELECT jsonb_agg(DISTINCT CASE WHEN link = to_jsonb($1::text)
                                          THEN to_jsonb($2::text) ELSE link END)
             FROM jsonb_array_elements(settings->'cross_repo_repos') AS link))
  WHERE settings->'cross_repo_repos' @> jsonb_build_array($1::text)`;

/** lore.plans.repo is a free-text column with no FK to lore.repos; without this a rename orphans every existing plan under the stale name. */
const MOVE_PLANS_SQL = "UPDATE lore.plans SET repo = $2 WHERE repo = $1";

/** Inside an open transaction: locks both names' rows, then renames `from` in place or merges it into `to`. */
export async function renameRepoRow(
  db: PgPool,
  from: string,
  to: string,
): Promise<RepoRenameOutcome> {
  const { rows } = await db.query<LockedRenameRow>(LOCK_RENAME_ROWS_SQL, [
    [from, to],
  ]);
  const source = rows.find((row) => row.full_name === from);
  const target = rows.find((row) => row.full_name === to);

  await repointPublicMirror(db, rows, from, to);

  if (!source) {
    return "absent";
  }
  const outcome = target
    ? await mergeRepoRows(db, source.id, target.id)
    : await renameRepoRowInPlace(db, source.id, to);

  await repointReferences(db, from, to);

  return outcome;
}

async function repointReferences(
  db: PgPool,
  from: string,
  to: string,
): Promise<void> {
  await db.query(REPOINT_CROSS_REPO_LINKS_SQL, [from, to]);
  await db.query(MOVE_PLANS_SQL, [from, to]);
}

async function repointPublicMirror(
  db: PgPool,
  rows: LockedRenameRow[],
  from: string,
  to: string,
): Promise<void> {
  const mirrorOwner = rows.find(
    (row) => row.mirrorName?.toLowerCase() === from.toLowerCase(),
  );

  if (mirrorOwner) {
    await db.query(REPOINT_PUBLIC_MIRROR_SQL, [mirrorOwner.id, to]);
  }
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

/** The new row keeps its own settings unless it has none; the old row's leftovers cascade with it. */
async function mergeRepoRows(
  db: PgPool,
  sourceId: string,
  targetId: string,
): Promise<RepoRenameOutcome> {
  await db.query(INHERIT_EMPTY_SETTINGS_SQL, [sourceId, targetId]);
  await db.query("DELETE FROM lore.repos WHERE id = $1", [sourceId]);

  return "merged";
}
