// How an Issue someone asked Lore to implement gets implemented: it joins the repository's backlog, where the implementation loop picks it up. There is no task to create for it (the `implementation` and `general` task types are gone, #2328 and #2329); the priority label is the whole opt-in.
import { implementationLoopEnabled } from "./implementation-loop-enabled.js";
import { PRIORITY_LABELS, type PriorityLabel } from "./labels.js";

/** The priority a ticket gets when the person who labelled it chose none. */
const DEFAULT_PRIORITY: PriorityLabel = "priority:medium";

export interface QueueTicketDeps {
  rawSettings(repo: string): Promise<unknown>;
  addLabel(issueNumber: number, label: string): Promise<void>;
  comment(issueNumber: number, body: string): Promise<void>;
}

export interface TicketToQueue {
  repo: string;
  issue: { number: number; labels: readonly string[] };
}

export async function queueTicket(
  deps: QueueTicketDeps,
  { repo, issue }: TicketToQueue,
): Promise<void> {
  const carried = PRIORITY_LABELS.find((label) => issue.labels.includes(label));

  if (!carried) {
    await deps.addLabel(issue.number, DEFAULT_PRIORITY);
  }
  const loopOn = implementationLoopEnabled(await deps.rawSettings(repo));

  await deps.comment(
    issue.number,
    queuedComment(repo, carried ?? DEFAULT_PRIORITY, loopOn),
  );
}

function queuedComment(
  repo: string,
  priority: PriorityLabel,
  loopOn: boolean,
): string {
  const queued = `Queued for Lore's implementation loop at \`${priority}\``;

  return loopOn
    ? `${queued}. The loop works one ticket of this repository at a time and picks this one up in priority order.`
    : `${queued}, but the loop is switched off for ${repo}, so nothing picks this ticket up until it is switched on in the repository's settings.`;
}
