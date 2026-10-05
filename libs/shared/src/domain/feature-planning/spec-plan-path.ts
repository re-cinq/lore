// The specs a spec-plan.json names: every one it creates, then every one it updates; the first of them is the one the plan is chiefly about.

interface SpecPlanPaths {
  creates?: Array<{ path?: unknown }>;
  updates?: Array<{ path?: unknown }>;
}

export function specPathOfPlan(content: string): string | undefined {
  return specPathsOfPlan(content)[0];
}

export function specPathsOfPlan(content: string): string[] {
  const plan = parseSpecPlan(content);

  return [...pathsOf(plan?.creates), ...pathsOf(plan?.updates)];
}

function parseSpecPlan(content: string): SpecPlanPaths | null {
  try {
    return JSON.parse(content) as SpecPlanPaths;
  } catch {
    return null;
  }
}

function pathsOf(entries: SpecPlanPaths["creates"]): string[] {
  const paths = (entries ?? []).map((entry) => entry.path);

  return paths.filter((path): path is string => typeof path === "string");
}
