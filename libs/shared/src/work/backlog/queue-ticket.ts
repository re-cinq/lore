// How an Issue someone asked Lore to implement gets implemented: it joins the repository's backlog, where the implementation loop picks it up. There is no task to create for it (the `implementation` and `general` task types are gone, #2328 and #2329); the priority label is the whole opt-in.
import { implementationLoopEnabled } from "./implementation-loop-enabled.js";
import { DEFAULT_PRIORITY, PRIORITY_LABELS } from "./labels.js";

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
  const queued = `Queued for Lore's implementation loop at \`${carried ?? DEFAULT_PRIORITY}\``;

  await deps.comment(
    issue.number,
    implementationLoopEnabled(await deps.rawSettings(repo))
      ? `${queued}. The loop works one ticket of this repository at a time and picks this one up in priority order.`
      : `${queued}, but the loop is switched off for ${repo}, so nothing picks this ticket up until it is switched on in the repository's settings.`,
  );
}
