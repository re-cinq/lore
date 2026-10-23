import type { Pool } from "pg";
import { BACKLOG_LABEL_SEED } from "@re-cinq/lore-shared";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import type { LoopKey } from "@re-cinq/lore-shared/loops/loop-kinds.js";
import { projectFor } from "../../../outbound/project-boot.js";
import { disarmAutoMerge } from "../repos/auto-merge-gate.js";

/** Where each loop's switch lives in `lore.repos.settings`: a boolean inside a named block, a top-level boolean, or (auto merge) the approver it names. */
const SWITCH_SQL: Record<LoopKey, string> = {
  implementation: blockSwitchSql("implementation_loop"),
  review: `UPDATE lore.repos
              SET settings = COALESCE(settings, '{}'::jsonb)
                || jsonb_build_object('auto_review', $2::boolean)
            WHERE full_name = $1`,
  merge: `UPDATE lore.repos
             SET settings = COALESCE(settings, '{}'::jsonb)
               || jsonb_build_object('auto_merge',
                    COALESCE(settings->'auto_merge', '{}'::jsonb)
                      || jsonb_build_object('approver',
                           CASE WHEN $2::boolean THEN 'lore-reviewer' ELSE 'none' END))
           WHERE full_name = $1`,
  triage: blockSwitchSql("issue_triage"),
};

/** Merges rather than replaces at BOTH levels — the repo's other settings and the block's own other keys must survive a switch. */
function blockSwitchSql(block: string): string {
  return `UPDATE lore.repos
            SET settings = COALESCE(settings, '{}'::jsonb)
              || jsonb_build_object('${block}',
                   COALESCE(settings->'${block}', '{}'::jsonb)
                     || jsonb_build_object('enabled', $2::boolean))
          WHERE full_name = $1`;
}

/** Flips one loop's switch. Switching the implementation loop on also seeds its labels; switching auto merge off takes back the auto-merge Lore armed. */
export async function switchLoop(
  pool: Pool,
  repo: string,
  key: LoopKey,
  { enabled }: { enabled: boolean },
): Promise<void> {
  await enforceRepoRow(pool, repo);
  await pool.query(SWITCH_SQL[key], [repo, enabled]);

  if (key === "implementation" && enabled) {
    await seedBacklogLabels(repo);
  }

  if (key === "merge" && !enabled) {
    await disarmAutoMerge(repo);
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
