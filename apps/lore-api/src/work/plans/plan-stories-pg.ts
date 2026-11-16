// The saved user story in Postgres, one row per plan: `lore.plan_stories`.

import {
  PLAN_STORY_COLUMNS as COLUMNS,
  PLAN_STORY_TABLE as TABLE,
} from "@re-cinq/lore-shared/models/plan-story.js";
import type { Db } from "../../outbound/plans/plan-store-pg.js";
import type { PlanStories, SavedStory } from "./plan-stories.js";

const SELECT_SAVED = `SELECT ${COLUMNS.issueNumber} AS "issueNumber"
  FROM ${TABLE} WHERE ${COLUMNS.planId}::text = $1`;

const UPSERT = `INSERT INTO ${TABLE}
  (${COLUMNS.planId}, ${COLUMNS.issueNumber}, ${COLUMNS.setBy})
  VALUES ($1, $2, $3)
  ON CONFLICT (${COLUMNS.planId}) DO UPDATE SET
    ${COLUMNS.issueNumber} = EXCLUDED.${COLUMNS.issueNumber},
    ${COLUMNS.setBy} = EXCLUDED.${COLUMNS.setBy},
    ${COLUMNS.setAt} = now()`;

export function pgPlanStories(db: Db): PlanStories {
  return {
    saved: async (planId) => {
      const { rows } = await db().query<SavedStory>(SELECT_SAVED, [planId]);

      return rows.at(0);
    },
    save: async ({ planId, issueNumber, setBy }) => {
      await db().query(UPSERT, [planId, issueNumber, setBy]);
    },
  };
}
