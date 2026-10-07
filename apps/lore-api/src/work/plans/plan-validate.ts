// Validate a plan before approval (specs/7-feature-planning): while the planning line waits on the author, a person asks for the validate station to run before the plan is approved.

import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import type { PlanLine } from "@re-cinq/lore-shared/project/plans/plan-run.js";

export interface PlanValidateInput {
  plan: { id: string; status: string };
  /** The plan's line, as `planLineState` read it. */
  line: PlanLine | null;
  actor: string;
}

/** The refusals a validation asks before it starts, whichever engine read the line. */
export function assertValidatable(
  plan: PlanValidateInput["plan"],
  line: PlanLine | null,
): asserts line is PlanLine {
  enforceTrue(
    plan.status === "draft",
    apiError(409),
    "the plan is approved; validation runs before approval",
  );
  enforceTrue(
    line !== null,
    apiError(409),
    "the plan has no planning line yet",
  );
  enforceTrue(
    line.parkedAuthor !== null,
    apiError(409),
    "the planning agent is still working; validate once it hands the plan back",
  );
}
