// The one spec a spec-plan.json is chiefly about: the first it creates, else the first it updates.

interface SpecPlanPaths {
  creates?: Array<{ path?: unknown }>;
  updates?: Array<{ path?: unknown }>;
}

export function specPathOfPlan(content: string): string | undefined {
  const plan = parseSpecPlan(content);

  return firstPath(plan?.creates) ?? firstPath(plan?.updates);
}

function parseSpecPlan(content: string): SpecPlanPaths | null {
  try {
    return JSON.parse(content) as SpecPlanPaths;
  } catch {
    return null;
  }
}

function firstPath(entries: SpecPlanPaths["creates"]): string | undefined {
  const path = entries?.[0]?.path;

  return typeof path === "string" ? path : undefined;
}
