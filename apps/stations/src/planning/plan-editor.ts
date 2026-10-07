// The one door the planning stations read a plan's findings through and write their own back: lore-api's plan routes, posted as whoever the station is (specs/7-feature-planning FR-19, FR-22).

import { z } from "zod";
import { requestPlan } from "./plan-api.js";
import type { PlanEdit, PlanSections } from "./plan-findings-ops.js";

export interface PlanEditor {
  planOf(planId: string): Promise<PlanSections>;
  /** The plan as markdown, as it stands right now. A pass started by hand is handed no fresh blob, so a station that grounds the bag's copy would read the round before it. */
  markdownOf(planId: string): Promise<string>;
  edit(edit: PlanEdit): Promise<void>;
}

// The plan projection lore-api serves at `GET /api/plans/{id}`, read only as far as its sections and their finding blocks.
const planProjectionSchema = z.object({
  json: z.object({
    sections: z.array(
      z.object({
        slot: z.string(),
        blocks: z.array(
          z.object({
            type: z.string(),
            props: z.record(z.string(), z.unknown()).default({}),
          }),
        ),
      }),
    ),
  }),
});

export function sectionsOf(projection: unknown): PlanSections {
  const { sections } = planProjectionSchema.parse(projection).json;

  return {
    sections: sections.map(({ slot, blocks }) => ({
      slot,
      findings: blocks
        .filter((block) => block.type === "finding")
        .map(({ props }) => ({
          findingId: String(props.findingId),
          resolved: props.resolved === true,
        })),
    })),
  };
}

/** Who the plan's people see the findings from; a station reconciles only the findings it posted. */
export function planEditorAs(actor: string): PlanEditor {
  return {
    planOf: async (planId) =>
      sectionsOf(await (await requestPlan(planId, { method: "GET" })).json()),
    markdownOf: async (planId) =>
      (await requestPlan(`${planId}/markdown`, { method: "GET" })).text(),
    edit: async ({ planId, ops }) => {
      await requestPlan(`${planId}/agent-edits`, {
        method: "POST",
        body: { actor, ops },
      });
    },
  };
}
