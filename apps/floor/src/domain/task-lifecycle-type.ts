/** Feature lifecycle types: each runs its own assembly line regardless of dark-factory and opens no per-task Issue (decompose files its own per story). */
export function isFeatureLifecycleType(taskType: string): boolean {
  return taskType === "feature-planning" || taskType === "feature-decompose";
}
