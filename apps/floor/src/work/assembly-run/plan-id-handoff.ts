// The plan id a feature-planning pod needs to read/write the plan it was launched for, carried from the run's own args into its prompt (mirrors spec-plan-handoff.ts).

/** The slot a recipe declares to receive the run's plan id; a recipe without it is untouched. */
export const PLAN_ID_SLOT = "{plan_id}";

/** Fill the recipe's `{plan_id}` slot with the run's plan id; a recipe without the slot, or a run whose args carry no plan id, is untouched. */
export function withPlanId(
  prompt: string,
  args: Readonly<Record<string, unknown>> | undefined,
): string {
  const planId = args?.plan_id;

  return typeof planId === "string" ? prompt.replaceAll(PLAN_ID_SLOT, planId) : prompt;
}
