// Every name the plan puts in backticks, checked against the default branch before anyone approves it (specs/7-feature-planning FR-22). Deterministic, so it runs on every pass of the plan rather than when someone clicks Validate. It grounds the plan as it stands, read live: a Refine starts `analyze` by hand and a start by hand stores no fresh markdown, so grounding the bag's copy re-reported every finding the pass had just fixed.

import {
  defineStation,
  type Handle,
  type Report,
  type RunningStation,
} from "@re-cinq/floor-station";
import { parseGitRef } from "@re-cinq/lore-shared/floor/floor-items.js";
import { projectFor } from "../../outbound/project-boot.js";
import { groundedText } from "../grounded-text.js";
import { planEditorAs, type PlanEditor } from "../plan-editor.js";
import {
  groundOwned,
  reconciledOps,
  type PlanEdit,
} from "../plan-findings-ops.js";
import { planGroundFindings } from "./findings.js";

const SUCCESS: Report = { outcome: "success" };

export interface PlanGroundingDeps extends PlanEditor {
  /** Every file path at a branch or commit. */
  listTree(repo: string, ref: string): Promise<string[]>;
  /** A file as it stands at a branch or commit; null when there is no such file. */
  readFile(repo: string, path: string, ref: string): Promise<string | null>;
}

export function planGroundingHandle(deps: PlanGroundingDeps): Handle {
  return async (brief) => {
    const planId = brief.needs.plan_id;
    const planMd = await deps.markdownOf(planId);
    const findings = await groundedPlan(deps, brief.needs.target, planMd);
    const plan = await deps.planOf(planId);

    await edit(deps, {
      planId,
      ops: reconciledOps(findings, plan, groundOwned),
    });

    return SUCCESS;
  };
}

async function groundedPlan(
  deps: PlanGroundingDeps,
  target: string,
  planMd: string,
) {
  const { repo, branch } = parseGitRef(target);
  const tree = await deps.listTree(repo, branch);
  const grounded = await groundedText(
    { path: "plan.md", text: planMd },
    tree,
    (path) => deps.readFile(repo, path, branch),
  );

  return planGroundFindings(planMd, grounded);
}

async function edit(
  deps: PlanGroundingDeps,
  planEdit: PlanEdit,
): Promise<void> {
  if (planEdit.ops.length > 0) {
    await deps.edit(planEdit);
  }
}

/** Who the plan's people see these findings from. */
const GROUNDING_ACTOR = "plan-grounding";

export const planGroundingDeps: PlanGroundingDeps = {
  ...planEditorAs(GROUNDING_ACTOR),
  listTree: async (repo, ref) => (await projectFor(repo)).repo.tree(ref),
  readFile: async (repo, path, ref) =>
    (await projectFor(repo)).repo.read(path, ref),
};

export function startPlanGroundingStation(): RunningStation {
  return defineStation(
    "plan-grounding",
    planGroundingHandle(planGroundingDeps),
  );
}
