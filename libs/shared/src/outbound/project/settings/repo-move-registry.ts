/** A table that stores a repository's full name: what a mirror's move does with its rows. */
export type RepoKeyedTable =
  | {
      schema: string;
      table: string;
      repoColumn: string;
      policy: "move";
      /** Columns that, with the repository, identify a row: a mirror row whose key already exists under the private name stays. Empty means one row per repository. */
      keyColumns: readonly string[];
    }
  | { schema: string; table: string; repoColumn: string; policy: "keep" }
  | { schema: string; table: string; repoColumn: string; policy: "row" }
  | { schema: "team"; table: "chunks"; repoColumn: "repo"; policy: "chunks" };

function movedWith(
  qualifiedTable: string,
  repoColumn: string,
  keyColumns: readonly string[],
): RepoKeyedTable {
  const [schema, table] = qualifiedTable.split(".");

  return { schema, table, repoColumn, policy: "move", keyColumns };
}

function keptFor(qualifiedTable: string, repoColumn: string): RepoKeyedTable {
  const [schema, table] = qualifiedTable.split(".");

  return { schema, table, repoColumn, policy: "keep" };
}

/** Every table that stores a repository's full name, each with what moving a mirror's knowledge does to it. Table and column names reach SQL only from here. */
export const REPO_KEYED_TABLES: readonly RepoKeyedTable[] = [
  { schema: "team", table: "chunks", repoColumn: "repo", policy: "chunks" },
  movedWith("memory.memories", "repo", ["agent_id", "key"]),
  movedWith("memory.entities", "repo", ["name", "entity_type"]),
  movedWith("lore.plans", "repo", ["id"]),
  movedWith("lore.plan_collab_tokens", "repo", ["token_hash"]),
  movedWith("lore.changelog_weeks", "repo", ["week_key"]),
  movedWith("lore.digest_posts", "repo", ["run_id"]),
  movedWith("lore.utopia_bases", "name", []),
  movedWith("lore.utopia_kind_sources", "repo", ["kind"]),
  movedWith("lore.utopia_pushed_items", "repo", ["path"]),
  movedWith("pipeline.ingest_state", "repo", ["kind"]),
  movedWith("pipeline.test_reports", "repo", ["commit"]),
  keptFor("pipeline.tasks", "target_repo"),
  keptFor("pipeline.pr_blocked_reasons", "repo"),
  keptFor("pipeline.audit_log", "repo"),
  keptFor("pipeline.events", "repo"),
  keptFor("pipeline.assembly_lines", "repo"),
  keptFor("pipeline.assembly_runs", "repo"),
  keptFor("lore.changelog_releases", "repo"),
  keptFor("lore.release_schedule_attempts", "repo"),
  keptFor("lore.utopia_sources", "repo"),
  keptFor("pipeline.api_tokens", "repos"),
  { schema: "lore", table: "repos", repoColumn: "full_name", policy: "row" },
];

/** Columns named like a repository that provably hold none: GitHub's `all` or `selected` choice of an installation. */
export const NOT_A_REPO_NAME_COLUMNS: readonly string[] = [
  "lore.github_installations.repository_selection",
];
