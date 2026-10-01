import { isRetiredTaskType } from "./retired-task-types.js";

/** What an Issue is dispatched to when it is to be implemented: not a task, but a place in the repository's backlog, where the implementation loop picks it up. */
export const BACKLOG_DISPATCH = "backlog";

/** The `lore:*` labels that dispatch an Issue — ONE declaration read by both the onboarding seeder and the dispatch webhook, so the two can't drift apart as they once did by hand. */
export interface DispatchLabel {
  /** The label as it appears on the Issue. */
  name: string;
  /** The task type it dispatches to, or {@link BACKLOG_DISPATCH}. */
  taskType: string;
  /** Hex colour, for the seeding call. */
  color: string;
  description: string;
}

export const DISPATCH_LABELS: readonly DispatchLabel[] = [
  {
    name: "lore:implementation",
    taskType: BACKLOG_DISPATCH,
    color: "0E8A16",
    description: "Lore: implement this ticket (joins the backlog loop)",
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

/** Where a labelled Issue goes: what its labels ask for, else the repository's configured default, else the backlog. A default still naming a removed task type means the backlog too, since that type implemented code. */
export function issueDispatchTarget(
  labels: readonly string[],
  configuredDefault?: string,
): string {
  const asked =
    dispatchTypeFromLabels(labels) ?? (configuredDefault || BACKLOG_DISPATCH);

  return isRetiredTaskType(asked) ? BACKLOG_DISPATCH : asked;
}
