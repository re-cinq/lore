// The plan validator's findings (specs/7-feature-planning): a deterministic pass over an approved plan, delivered as plan-validation-result.json and turned into findings on the plan by the Floor.

import { z } from "zod";

/** The artifact event the validator's result arrives as. */
export const PLAN_VALIDATION_RESULT_EVENT = "plan.validation.result";

export const planValidationResultSchema = z.object({
  findings: z.array(
    z.object({
      slot: z.string().min(1),
      text: z.string().min(1),
      why: z.string().default(""),
      severity: z.enum(["blocker", "warning"]).default("warning"),
      /** The finding's stable id, when the validator already keyed one; otherwise derived from slot + text. */
      finding_id: z.string().optional(),
    }),
  ),
});

export type PlanValidationResult = z.infer<typeof planValidationResultSchema>;
