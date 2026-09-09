/** The `lore:*` labels that dispatch an Issue to a task type — ONE declaration read by both the onboarding seeder and the dispatch webhook, so the two can't drift apart as they once did by hand. */
export interface DispatchLabel {
  /** The label as it appears on the Issue. */
  name: string;
  /** The task type it dispatches to. */
  taskType: string;
  /** Hex colour, for the seeding call. */
  color: string;
  description: string;
}

export const DISPATCH_LABELS: readonly DispatchLabel[] = [
  {
    name: "lore:implementation",
    taskType: "implementation",
    color: "0E8A16",
    description: "Lore: implementation task",
  },
  {
    name: "lore:review",
    taskType: "review",
    color: "1D76DB",
    description: "Lore: review task",
  },
  {
    name: "lore:runbook",
    taskType: "runbook",
    color: "D93F0B",
    description: "Lore: runbook task",
  },
];

/** The task type an Issue's labels ask for, or null when none do (caller supplies its own default via `settings.dispatch_default_type`); first match wins in declaration order for determinism. */
export function dispatchTypeFromLabels(
  labels: readonly string[],
): string | null {
  return (
    DISPATCH_LABELS.find((label) => labels.includes(label.name))?.taskType ??
    null
  );
}
