import type { Pool } from "pg";
import { BACKLOG_LABEL_SEED } from "@re-cinq/lore-shared";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import type { LoopKey } from "@re-cinq/lore-shared/loops/loop-kinds.js";
import { projectFor } from "../../../outbound/project-boot.js";

/** The `lore.repos.settings` block each loop's `enabled` lives in. */
const SETTINGS_BLOCK: Record<LoopKey, string> = {
  implementation: "implementation_loop",
  triage: "issue_triage",
};

/** Flips one loop's `enabled` flag. The UPDATE merges rather than replaces at BOTH levels — the repo's other settings and the block's own other keys must survive a switch. Switching the implementation loop on also seeds its labels. */
export async function switchLoop(
  pool: Pool,
  repo: string,
  key: LoopKey,
  { enabled }: { enabled: boolean },
): Promise<void> {
  await enforceRepoRow(pool, repo);
  await pool.query(
    `UPDATE lore.repos
            SET settings = COALESCE(settings, '{}'::jsonb)
              || jsonb_build_object($2::text,
                   COALESCE(settings->$2::text, '{}'::jsonb)
                     || jsonb_build_object('enabled', $3::boolean))
          WHERE full_name = $1`,
    [repo, SETTINGS_BLOCK[key], enabled],
  );

  if (key === "implementation" && enabled) {
    await seedBacklogLabels(repo);
  }
}

async function enforceRepoRow(pool: Pool, repo: string): Promise<void> {
  const { rows } = await pool.query<{ full_name: string }>(
    "SELECT full_name FROM lore.repos WHERE full_name = $1",
    [repo],
  );

  enforceTrue(rows.length > 0, apiError(404), `repo not found: ${repo}`);
}

/** Seeds the implementation loop's label taxonomy (specs/implementation-loop FR1/FR7) for repos onboarded before the feature existed. Create-or-ignore, and swallowed: the settings write has already committed, so a code-host hiccup must not report the switch as failed. */
async function seedBacklogLabels(repo: string): Promise<void> {
  try {
    await (await projectFor(repo)).issues.createLabels(BACKLOG_LABEL_SEED);
  } catch (err) {
    console.warn(
      `[implementation-loop] label seeding for ${repo} failed: ${String(err)}`,
    );
  }
}
