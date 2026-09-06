import type { PgPool } from "../../memory-store.js";

/** Repo ingest freshness: the warning banner shown when a repo's context is stale or was never ingested. */

const STALE_AGE_MS = 7 * 86400000;

export function computeFreshness(
  lastIngestedAt: Date | string | null,
  now: Date,
): "fresh" | "stale" | "never-ingested" {
  if (!lastIngestedAt) {
    return "never-ingested";
  }

  const age = now.getTime() - new Date(lastIngestedAt).getTime();

  return age > STALE_AGE_MS ? "stale" : "fresh";
}

export interface FreshnessInfo {
  state: string;
  warning: string;
}

function freshnessForRepo(
  row: { last_ingested_at: string | Date | null } | undefined,
  now: Date,
): FreshnessInfo {
  if (!row) {
    return {
      state: "first-run",
      warning: `> **Welcome to Lore!** This repo is not yet onboarded.\n> Suggested actions:\n> 1. Call \`lore_onboard_repo\` to generate CLAUDE.md and register the repo\n> 2. Call \`lore_ingest_files\` to manually add specific files\n> 3. Call \`lore_search_memory\` to check if others have left learnings\n\n`,
    };
  }
  const lastIngestedAt = row.last_ingested_at;
  const state = computeFreshness(lastIngestedAt, now);

  if (state === "never-ingested") {
    return {
      state,
      warning: `> ⚠ **Context may be stale** — this repo has never been ingested. Run \`lore_ingest_files\` or wait for the nightly reindex.\n\n`,
    };
  }

  if (state === "stale" && lastIngestedAt) {
    const days = Math.floor(
      (now.getTime() - new Date(lastIngestedAt).getTime()) / 86400000,
    );

    return {
      state,
      warning: `> ⚠ **Context may be stale** — last ingested ${days} days ago.\n\n`,
    };
  }

  return { state, warning: "" };
}

export async function resolveFreshness(
  pool: PgPool,
  repo: string | undefined,
): Promise<FreshnessInfo> {
  if (!repo) {
    return { state: "unknown", warning: "" };
  }

  try {
    const { rows } = await pool.query<{
      last_ingested_at: string | Date | null;
    }>(`SELECT last_ingested_at FROM lore.repos WHERE full_name = $1`, [repo]);

    return freshnessForRepo(rows[0], new Date());
  } catch {
    return { state: "unknown", warning: "" };
  }
}
