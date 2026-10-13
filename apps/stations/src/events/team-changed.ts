// What a repository's team change does to its stored context: the rows written under `org_shared` before the repository had a team move into the team's schema, because reads resolve to that schema from now on and would no longer see them.
import { ORG_SHARED_SCHEMA } from "@re-cinq/lore-shared/project/chunks/chunk-schema.js";

export interface TeamChangeDeps {
  /** Read from `lore.repos`, not taken from the event: the row is the truth by the time the delivery is claimed. */
  team(repo: string): Promise<string | null>;
  /** The schema a team's context lives in, `org_shared` when the team has none. Uncached, since a memoized answer would be the schema from before the change. */
  chunkSchema(team: string | null): Promise<string>;
  relocate(
    schema: string,
    repo: string,
  ): Promise<{ moved: number; dropped: number }>;
}

/** Moves the repository's legacy rows and says what happened. A failed move throws, so the delivery is retried: the move is idempotent. */
export async function relocateOnTeamChange(
  deps: TeamChangeDeps,
  repo: string,
): Promise<string> {
  const schema = await deps.chunkSchema(await deps.team(repo));

  if (schema === ORG_SHARED_SCHEMA) {
    return `resolves to ${ORG_SHARED_SCHEMA}, nothing to relocate`;
  }
  const { moved, dropped } = await deps.relocate(schema, repo);

  return dropped > 0
    ? `moved ${moved} of ${dropped} legacy ${ORG_SHARED_SCHEMA} rows into ${schema} (the rest were stale duplicates of files already there)`
    : `no legacy ${ORG_SHARED_SCHEMA} rows to move into ${schema}`;
}
