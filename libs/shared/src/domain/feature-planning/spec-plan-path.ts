import { specFileOf } from "./issue-coverage.js";

// The spec files a spec-plan.json names: every one it creates, then every one it updates; the first of them is the one the plan is chiefly about. A plan may name a spec by its folder, as `specs/<name>/`, and the file is that folder's spec.md.

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

  return paths
    .filter((path): path is string => typeof path === "string")
    .map(specFileOf);
}

/** Every spec.md a run's spec PR wrote, `spec_path`'s first; just `spec_path`'s for a run whose line reads no spec plan. */
export function specFilesOfRun(
  specPath: string | undefined,
  specPlan: string | undefined,
): string[] {
  const paths = [
    ...(specPath ? [specPath] : []),
    ...(specPlan ? specPathsOfPlan(specPlan) : []),
  ];

  return [...new Set(paths.map(specFileOf))];
}
