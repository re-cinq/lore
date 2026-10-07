// Why the implementation loop is not working a ticket, and what its reader does about it. The one place that wording lives: the backlog page shows it per ticket, since a reader cannot see the driver's log.
import { classifyError } from "../../lib/error-classify.js";
import { LORE_BLOCKED_LABEL, PRIORITY_LABELS } from "./labels.js";
import { ticketTextTooLong } from "./ticket-description.js";

export const TICKET_HOLD_KINDS = [
  "text_too_long",
  "waits_on_blockers",
  "two_priorities",
  "parked",
  "failed",
] as const;

export interface TicketHold {
  kind: (typeof TICKET_HOLD_KINDS)[number];
  message: string;
  fix: string;
}

interface HeldIssue {
  title: string;
  body?: string;
  labels: readonly string[];
}

/** How the newest attempt on the ticket ended, in the settling hook's own words when it stored any. */
interface LastAttempt {
  status: string;
  why: string | null;
}

export interface TicketHoldInput {
  /** Absent once the issue is closed: only the attempt can still hold the ticket. */
  issue?: HeldIssue;
  /** Numbers of the open issues linked as blocking this one. */
  openBlockers: readonly number[];
  lastAttempt?: LastAttempt;
  /** A task already took the ticket, so what would stop the picker no longer says anything about it. */
  picked?: boolean;
}

/** The first thing holding a ticket, or null when nothing does. What the ticket itself must change comes before what happened to its last attempt. */
export function ticketHold(input: TicketHoldInput): TicketHold | null {
  const holds = input.picked ? ATTEMPT_HOLDS : QUEUE_HOLDS;

  return holds.flatMap((holdOf) => holdOf(input) ?? []).at(0) ?? null;
}

type HoldOf = (input: TicketHoldInput) => TicketHold | null;

/** What can hold a ticket a task took: only how its attempt ended. */
const ATTEMPT_HOLDS: readonly HoldOf[] = [parked, failed];

const QUEUE_HOLDS: readonly HoldOf[] = [
  parked,
  twoPriorities,
  textTooLong,
  waitsOnBlockers,
  failed,
];

function parked({ issue, lastAttempt }: TicketHoldInput): TicketHold | null {
  if (!issue?.labels.includes(LORE_BLOCKED_LABEL)) {
    return null;
  }

  return {
    kind: "parked",
    message: lastAttempt?.why
      ? `The loop parked this ticket: ${lastAttempt.why}.`
      : "The loop parked this ticket; the reason is in the issue's comments.",
    fix: `Fix what it names, then remove the ${LORE_BLOCKED_LABEL} label to re-queue it.`,
  };
}

function twoPriorities({ issue }: TicketHoldInput): TicketHold | null {
  const carried = PRIORITY_LABELS.filter((p) => issue?.labels.includes(p));

  return carried.length > 1
    ? {
        kind: "two_priorities",
        message: "Carries two priority labels, so the loop cannot rank it.",
        fix: "Keep exactly one priority label.",
      }
    : null;
}

/** Worded about TEXT, so it does not read as a ticket with too much work in it. */
function textTooLong({ issue }: TicketHoldInput): TicketHold | null {
  return issue && ticketTextTooLong(issue)
    ? {
        kind: "text_too_long",
        message:
          "The issue's title and body are longer than a task description may be, so the loop will not pick it.",
        fix: "Shorten the issue text.",
      }
    : null;
}

function waitsOnBlockers({ openBlockers }: TicketHoldInput): TicketHold | null {
  if (openBlockers.length === 0) {
    return null;
  }
  const blockers = openBlockers.map((n) => `#${n}`).join(", ");
  const stillOpen =
    openBlockers.length === 1 ? "is still open" : "are still open";

  return {
    kind: "waits_on_blockers",
    message: `Waits on ${blockers}, which ${stillOpen}.`,
    fix: "Close them, or remove the blocked-by link if it no longer applies.",
  };
}

function failed({ lastAttempt }: TicketHoldInput): TicketHold | null {
  if (lastAttempt?.status !== "failed") {
    return null;
  }
  const { why } = lastAttempt;

  return {
    kind: "failed",
    message: why
      ? `The last attempt failed: ${why}.`
      : "The last attempt failed.",
    fix: failedFix(why ?? ""),
  };
}

/** The floor's own word for a dispatch no worker took; the classifier does not know it. */
const UNCLAIMED = /\bunclaimed:/;

const CLUSTER_FAILURES: readonly string[] = ["infra", "repo-checkout"];

function failedFix(why: string): string {
  const { category, hint } = classifyError(why);

  if (UNCLAIMED.test(why) || CLUSTER_FAILURES.includes(category)) {
    return "Nothing to do: the cluster failed, not the ticket, and the loop picks it again on its next tick.";
  }

  return category === "unknown"
    ? "Open the run to see where it stopped."
    : hint;
}
