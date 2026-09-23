import type { PlanMeta } from "@re-cinq/planning-document";
import type { PlanningService } from "@re-cinq/planning-sync";
import { toProblem } from "@re-cinq/planning-sync/hapi";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";

export type PlanApprover = Pick<PlanningService, "approvePlan">;

/** The library's approval, refused as lore's own 409 carrying the validation report, so the web tier reads one error shape for every plan route. */
export async function approveOrRefuse(
  service: PlanApprover,
  planId: string,
  approvedBy: string,
): Promise<PlanMeta> {
  try {
    return await service.approvePlan({ planId, approvedBy });
  } catch (err) {
    const problem = toProblem(err);

    throw apiError(problem.status, { problems: problem.problems ?? [] })(
      problem.detail,
    );
  }
}
