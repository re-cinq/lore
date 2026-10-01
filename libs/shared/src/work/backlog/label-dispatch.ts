// What labelling an Issue for Lore does: it joins the repository's backlog. The label used to create a typed task; every type it could name is gone, and code is implemented by the loop from the backlog (#2328, #2329).
import { DISPATCH_LABELS } from "../../domain/task-types/dispatch-labels.js";
import { queueTicket, type QueueTicketDeps } from "./queue-ticket.js";

const DEFAULT_DISPATCH_LABEL = "lore";

export interface LabelDispatchDeps extends QueueTicketDeps {
  /** The task still holding the issue, when one is. */
  activeTaskByIssue(
    repo: string,
    issueNumber: number,
  ): Promise<{ id: string } | null>;
}

export interface LabeledIssue {
  repo: string;
  /** The label that was just applied. */
  label: string;
  issue: { number: number; labels: readonly string[] };
}

export async function dispatchLabeledIssue(
  deps: LabelDispatchDeps,
  { repo, label, issue }: LabeledIssue,
): Promise<void> {
  if (!asksForLore(label, await deps.rawSettings(repo))) {
    return;
  }
  const working = await deps.activeTaskByIssue(repo, issue.number);

  if (working) {
    await deps.comment(
      issue.number,
      `Already being worked on: task \`${working.id}\``,
    );

    return;
  }
  await queueTicket(deps, { repo, issue });
}

/** Whether the label asks Lore for the Issue: the repository's dispatch label, or one of the labels onboarding seeds it with. */
function asksForLore(label: string, rawSettings: unknown): boolean {
  return (
    label === dispatchLabelOf(rawSettings) ||
    DISPATCH_LABELS.some((seeded) => seeded.name === label)
  );
}

/** The repository's own dispatch label, else `lore`. */
function dispatchLabelOf(rawSettings: unknown): string {
  const parsed = (
    typeof rawSettings === "string" ? JSON.parse(rawSettings) : rawSettings
  ) as { dispatch_label?: string } | null;

  return parsed?.dispatch_label || DEFAULT_DISPATCH_LABEL;
}
