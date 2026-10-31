import type { Pool } from "pg";
import { BACKLOG_LABEL_SEED } from "@re-cinq/lore-shared";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import type { LoopKey } from "@re-cinq/lore-shared/loops/loop-kinds.js";
import { PgSettings } from "@re-cinq/lore-shared/project/settings/settings-pg.js";
import { floorClient } from "@re-cinq/lore-shared/floor/floor-client.js";
import { loopPause } from "@re-cinq/lore-shared/loops/loop-pause.js";
import {
  resumeLoop,
  type ResumeLoopDeps,
} from "../../../work/loops/resume-loop.js";
import { handleRunNode } from "../floor/run-node.js";
import { storedBlock } from "@re-cinq/lore-shared/project/settings/settings-sql.js";
import { projectFor } from "../../../outbound/project-boot.js";
import { disarmAutoMerge } from "../repos/auto-merge-gate.js";

/** Where each loop's switch lives in `lore.repos.settings`: a boolean inside a named block, or a top-level boolean. */
const SWITCH_SQL: Record<LoopKey, string> = {
  implementation: blockSwitchSql("implementation_loop"),
  review: `UPDATE lore.repos
              SET settings = COALESCE(settings, '{}'::jsonb)
                || jsonb_build_object('auto_review', $2::boolean)
            WHERE full_name = $1`,
  merge: blockSwitchSql("auto_merge"),
  triage: blockSwitchSql("issue_triage"),
  upkeep: blockSwitchSql("spec_upkeep"),
  digest: blockSwitchSql("digest"),
  tickets: blockSwitchSql("spec_tickets"),
};

/** Merges rather than replaces at BOTH levels — the repo's other settings and the block's own other keys must survive a switch. */
function blockSwitchSql(block: string): string {
  return `UPDATE lore.repos
            SET settings = COALESCE(settings, '{}'::jsonb)
              || jsonb_build_object('${block}',
                   ${storedBlock(block)}
                     || jsonb_build_object('enabled', $2::boolean))
          WHERE full_name = $1`;
}

/** Flips one loop's switch on a repository the caller has already found (`enforceRepoRow`). Switching a loop on also forgets its pause; switching the implementation loop on also seeds its labels; switching auto merge off takes back the auto-merge Lore armed. */
export async function switchLoop(
  pool: Pool,
  repo: string,
  { key, enabled }: { key: LoopKey; enabled: boolean },
): Promise<void> {
  await pool.query(SWITCH_SQL[key], [repo, enabled]);

  if (enabled) {
    await resumeLoopOf(pool, repo, key);
  }

  if (key === "implementation" && enabled) {
    await seedBacklogLabels(repo);
  }

  if (key === "merge" && !enabled) {
    await disarmAutoMerge(repo);
  }
}

/** Resumes the repo's loop the way its Resume does: the station its pause starved runs again first, for a loop started once per item. Answers the run started again, or null. */
export async function resumeLoopOf(
  pool: Pool,
  repo: string,
  key: LoopKey,
): Promise<string | null> {
  const settings = new PgSettings(pool);
  const pause = loopPause(key, await settings.rawSettings(repo));

  return resumeLoop(key, pause, {
    resume: () => settings.resumeLoop(repo, key),
    ...floorRerun(pool),
  });
}

/** Who a station run again on resume is recorded as asked by. */
const RESUME_ACTOR = "lore:loop-resume";

/** Reads a run's visits from the floor and runs one of its stations again, as a start by hand does. */
function floorRerun(pool: Pool): Omit<ResumeLoopDeps, "resume"> {
  return {
    visits: (runId) => floorClient().stationRuns.list({ run: runId }),
    rerun: async (runId, nodeId) => {
      await handleRunNode(floorClient(), pool, {
        runId,
        nodeId,
        actor: RESUME_ACTOR,
      });
    },
  };
}

export async function enforceRepoRow(pool: Pool, repo: string): Promise<void> {
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
