// A spec gate that gave up settles here: the checks the spec could not uphold go onto the plan as blocker findings, one per check in its section, and the line parks on the author. The plan is what to fix, so no PR opens from a spec that disagrees with it (specs/7-feature-planning/spec.md FR-24).

import {
  defineStation,
  type Handle,
  type RunningStation,
  type Tools,
} from "@re-cinq/floor-station";
import { z } from "zod";
import { specFindingsOf } from "@re-cinq/lore-shared/feature-planning/spec-findings.js";
import { planEditorAs } from "../plan-editor.js";
import {
  reconciledOps,
  specOwned,
  type PlanEdit,
  type PlanSections,
} from "../plan-findings-ops.js";

const verdictSchema = z.object({
  rounds: z.number().int().nonnegative(),
  failures: z.array(
    z.object({
      id: z.string(),
      section: z.string(),
      text: z.string(),
      reason: z.string(),
    }),
  ),
});

export interface SpecFindingsDeps {
  planOf(planId: string): Promise<PlanSections>;
  edit(edit: PlanEdit): Promise<void>;
}

export function specFindingsHandle(deps: SpecFindingsDeps): Handle {
  return async (brief, tools) => {
    try {
      await writeFindings(deps, brief.needs.plan_id, await verdictOf(tools));

      return { outcome: "success" };
    } catch (err) {
      return { outcome: "failed", error: (err as Error).message };
    }
  };
}

async function verdictOf(tools: Tools): Promise<z.infer<typeof verdictSchema>> {
  const text = (await tools.read("qa_verdict")).toString("utf8");

  return verdictSchema.parse(JSON.parse(text));
}

async function writeFindings(
  deps: SpecFindingsDeps,
  planId: string,
  verdict: z.infer<typeof verdictSchema>,
): Promise<void> {
  const findings = specFindingsOf(verdict.failures, verdict.rounds);
  const ops = reconciledOps(findings, await deps.planOf(planId), specOwned);

  if (ops.length > 0) {
    await deps.edit({ planId, ops });
  }
}

export function startSpecFindingsStation(): RunningStation {
  const editor = planEditorAs("spec-gate");

  return defineStation(
    "spec-findings",
    specFindingsHandle({ planOf: editor.planOf, edit: editor.edit }),
  );
}
