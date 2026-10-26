// The upkeep's give-up rule at work (specs/external-floor FR12.19b): each pull request's upkeep runs since its ticket's last park are judged, and an exhausted one parks its ticket with the reason instead of getting another run.
import { LORE_BLOCKED_LABEL } from "@re-cinq/lore-shared/backlog/labels.js";
import { issueNumberFromLoopBranch } from "@re-cinq/lore-shared/backlog/loop-merge-success.js";
import {
  lastParkedAt,
  upkeepExhausted,
  upkeepExhaustedComment,
  type UpkeepExhaustion,
} from "@re-cinq/lore-shared/backlog/loop-pr-upkeep.js";
import type {
  IssueComment,
  PullRef,
} from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";

/** The ticket reads and writes the rule needs. */
export interface UpkeepTickets {
  issues: {
    listComments(number: number): Promise<IssueComment[]>;
    addLabel(number: number, label: string): Promise<void>;
    comment(number: number, body: string): Promise<void>;
  };
}

export interface Judged {
  pull: PullRef;
  exhaustion: UpkeepExhaustion | null;
}

/** Each pull request's upkeep runs since its ticket was last parked, judged; a pull request with no ticket is judged on all of them. */
export function judgeExhaustion(
  project: UpkeepTickets,
  pulls: readonly PullRef[],
  lineRuns: Parameters<typeof upkeepExhausted>[1],
): Promise<Judged[]> {
  return Promise.all(
    pulls.map(async (pull) => ({
      pull,
      exhaustion: upkeepExhausted(
        pull.number,
        lineRuns,
        await parkedSince(project, pull),
      ),
    })),
  );
}

async function parkedSince(
  { issues }: UpkeepTickets,
  pull: PullRef,
): Promise<string | null> {
  const number = issueNumberFromLoopBranch(pull.branch);

  return number === null
    ? null
    : lastParkedAt(await issues.listComments(number));
}

/** The pull requests the loop may still start a run for. */
export function freshOf(judged: readonly Judged[]): PullRef[] {
  return judged.flatMap(({ pull, exhaustion }) => (exhaustion ? [] : [pull]));
}

export function parks(
  project: UpkeepTickets,
  judged: readonly Judged[],
): Promise<string>[] {
  return judged.flatMap(({ pull, exhaustion }) =>
    exhaustion ? [parkOutcome(project, pull, exhaustion)] : [],
  );
}

/** The ticket is parked with the reason instead of getting another run; a person's until they take the label off, as after any park. */
async function parkOutcome(
  { issues }: UpkeepTickets,
  pull: PullRef,
  exhaustion: UpkeepExhaustion,
): Promise<string> {
  const number = issueNumberFromLoopBranch(pull.branch);

  if (number === null) {
    return `#${pull.number} upkeep ${exhaustion.kind}, no ticket to park`;
  }
  await issues.addLabel(number, LORE_BLOCKED_LABEL);
  await issues.comment(number, upkeepExhaustedComment(pull, exhaustion));

  return `#${pull.number} parked #${number}: upkeep ${exhaustion.kind} after ${exhaustion.runs} runs`;
}
