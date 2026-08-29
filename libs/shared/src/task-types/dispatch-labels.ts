/**
 * The `lore:*` labels that dispatch an Issue to a task type — ONE declaration,
 * read by both the repo that gets them seeded and the webhook that reads them.
 *
 * They were declared twice by hand: onboarding created three labels with their
 * colours and descriptions, and the webhook matched the same three names in an
 * if/else chain. Nothing tied the two together, so a fourth label seeded on a
 * repo (by onboarding, or by a person copying the pattern) dispatched as the
 * repo's default type instead of the one it names — and a task type removed from
 * `task-types.yaml` left a label behind that creates tasks no handler serves.
 */
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

/**
 * The task type an Issue's labels ask for, or null when none of them do — the
 * caller supplies its own default, because "no label" is the repo's choice to
 * make (`settings.dispatch_default_type`) rather than this table's.
 *
 * First match wins, in declaration order, so a mislabelled Issue carrying two
 * dispatch labels resolves deterministically instead of by chain order.
 */
export function dispatchTypeFromLabels(
  labels: readonly string[],
): string | null {
  return (
    DISPATCH_LABELS.find((label) => labels.includes(label.name))?.taskType ??
    null
  );
}
