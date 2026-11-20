import type { PgPool } from "../../../domain/memory-store-types.js";
import { REPOINT_CROSS_REPO_LINKS_SQL } from "./repo-rename.js";

/** Settings the mirror's row never hands to the private repo: they describe the mirror's own release and loop switches. */
export const NOT_CARRIED_SETTINGS: readonly string[] = [
  "public_mirror",
  "release",
  "implementation_loop",
  "auto_review",
  "auto_merge",
  "issue_triage",
  "spec_upkeep",
  "spec_tickets",
  "digest",
  "loop_pauses",
];

type Settings = Record<string, unknown>;

/** The private repo's settings with every key it lacks taken from the mirror's, except the keys no mirror hands over. */
export function settingsAfterMirrorMerge(
  mirrorSettings: Settings | null,
  privateSettings: Settings | null,
): Settings {
  const carried = Object.fromEntries(
    Object.entries(mirrorSettings ?? {}).filter(
      ([key]) => !NOT_CARRIED_SETTINGS.includes(key),
    ),
  );

  return { ...carried, ...privateSettings };
}

const MERGE_SETTINGS_SQL = `UPDATE lore.repos target
    SET settings = (CASE WHEN jsonb_typeof(source.settings) = 'object' THEN source.settings ELSE '{}'::jsonb END - $3::text[])
                   || (CASE WHEN jsonb_typeof(target.settings) = 'object' THEN target.settings ELSE '{}'::jsonb END)
   FROM lore.repos source
  WHERE source.full_name = $1 AND target.full_name = $2`;

/** A repo does not link to itself: once the mirror's name was pointed at the private repo, the private repo's own row drops that entry. */
const DROP_SELF_LINK_SQL = `UPDATE lore.repos
    SET settings = jsonb_set(settings, '{cross_repo_repos}',
          COALESCE((SELECT jsonb_agg(link)
                      FROM jsonb_array_elements(settings->'cross_repo_repos') AS link
                     WHERE link <> to_jsonb($1::text)), '[]'::jsonb))
  WHERE full_name = $1 AND settings->'cross_repo_repos' @> jsonb_build_array($1::text)`;

const DELETE_ROW_SQL = "DELETE FROM lore.repos WHERE full_name = $1";

/** Folds the mirror's `lore.repos` row into its private repo's, points every repo's cross-repo link to the mirror at the private repo, then deletes the mirror's row. Run it on one connection with its caller's transaction. */
export async function absorbMirrorRow(
  db: Pick<PgPool, "query">,
  mirror: string,
  privateRepo: string,
): Promise<void> {
  await db.query(REPOINT_CROSS_REPO_LINKS_SQL, [mirror, privateRepo]);
  await db.query(MERGE_SETTINGS_SQL, [
    mirror,
    privateRepo,
    NOT_CARRIED_SETTINGS,
  ]);
  await db.query(DROP_SELF_LINK_SQL, [privateRepo]);
  await db.query(DELETE_ROW_SQL, [mirror]);
}

/** The settings without the cross-repo link to `name`. */
export function settingsWithoutLink(
  settings: Settings,
  name: string,
): Settings {
  const links = settings.cross_repo_repos;

  return Array.isArray(links)
    ? { ...settings, cross_repo_repos: links.filter((link) => link !== name) }
    : settings;
}
