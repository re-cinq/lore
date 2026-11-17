// Drops the new tasks of a spec's decomposition that an existing ticket already holds, before the issues station files them (specs/spec-tickets FR27). Pure: the station searches, this decides.
import type {
  DecompTask,
  DecompositionResult,
  UserStory,
} from "../../domain/feature-planning/decomposition-result.js";

// Utopia search scores have no fixed scale; these are calibrated from the bot tickets filed since 2026-10-24 whose work had already merged, and are meant to move with that history.
export const DUPLICATE_SCORE = 0.85;
export const RELATED_SCORE = 0.6;

const QUERY_DESCRIPTION_LENGTH = 200;

export interface TicketMatch {
  number: number;
  title: string;
  state: "open" | "closed";
  score: number;
}

export type TicketSearchOutcome =
  { tickets: TicketMatch[]; notes?: string[] } | { error: string };

/** The tickets an earlier run filed for this spec: their task ids are rewrites, their numbers never count as a match. */
export interface OwnTickets {
  ids: ReadonlySet<string>;
  numbers: ReadonlySet<number>;
}

export interface Thresholds {
  duplicate: number;
  related: number;
}

export type DedupeVerdict =
  | {
      taskId: string;
      verdict: "duplicate_of" | "done_in" | "related";
      ticket: number;
    }
  | { taskId: string; verdict: "search_failed"; reason: string };

export interface DedupeResult {
  decomposition: DecompositionResult;
  report: DedupeVerdict[];
}

/** The tasks that would be filed as new issues, the only ones worth a search. */
export function newTasks(
  decomposition: DecompositionResult,
  own: OwnTickets,
): DecompTask[] {
  const { stories } = decomposition;
  const tasks = stories.flatMap((story) => story.tasks);

  return tasks.filter((task) => !own.ids.has(task.id));
}

export function ticketQuery(task: DecompTask): string {
  const title = task.title ?? "";

  return `${title}\n${task.description.slice(0, QUERY_DESCRIPTION_LENGTH)}`.trim();
}

const DEFAULT_THRESHOLDS: Thresholds = {
  duplicate: DUPLICATE_SCORE,
  related: RELATED_SCORE,
};

export function dedupeDecomposition(
  decomposition: DecompositionResult,
  searches: ReadonlyMap<string, TicketSearchOutcome>,
  own: OwnTickets,
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
): DedupeResult {
  const verdicts = new Map(
    newTasks(decomposition, own)
      .map((task) => verdictOf(task.id, searches.get(task.id), own, thresholds))
      .filter((verdict): verdict is DedupeVerdict => verdict !== null)
      .map((verdict) => [verdict.taskId, verdict]),
  );
  const kept = decomposition.stories.map((story) => keptStory(story, verdicts));
  const stories = kept.filter((story) => story.tasks.length > 0);

  return {
    decomposition: { ...decomposition, stories },
    report: [...verdicts.values()],
  };
}

function verdictOf(
  taskId: string,
  search: TicketSearchOutcome | undefined,
  own: OwnTickets,
  thresholds: Thresholds,
): DedupeVerdict | null {
  if (search === undefined) {
    return null;
  }
  const failure = searchFailure(search);

  if (failure !== null) {
    return { taskId, verdict: "search_failed", reason: failure };
  }
  const best = "tickets" in search ? bestMatch(search.tickets, own) : undefined;

  return best ? matchVerdict(taskId, best, thresholds) : null;
}

/** A search that failed, or answered notes because the repository has no Utopia base, decides nothing. */
function searchFailure(search: TicketSearchOutcome): string | null {
  if ("error" in search) {
    return search.error;
  }

  return search.notes?.length ? search.notes.join("; ") : null;
}

function bestMatch(
  tickets: TicketMatch[],
  own: OwnTickets,
): TicketMatch | undefined {
  return tickets
    .filter((ticket) => !own.numbers.has(ticket.number))
    .reduce<TicketMatch | undefined>(
      (best, ticket) => (best && best.score >= ticket.score ? best : ticket),
      undefined,
    );
}

// The search answers open or closed only, so a closed ticket is read as done rather than declined.
function matchVerdict(
  taskId: string,
  best: TicketMatch,
  thresholds: Thresholds,
): DedupeVerdict | null {
  if (best.score >= thresholds.duplicate) {
    const verdict = best.state === "open" ? "duplicate_of" : "done_in";

    return { taskId, verdict, ticket: best.number };
  }

  return best.score >= thresholds.related
    ? { taskId, verdict: "related", ticket: best.number }
    : null;
}

function keptStory(
  story: UserStory,
  verdicts: ReadonlyMap<string, DedupeVerdict>,
): UserStory {
  const { tasks: planned } = story;
  const tasks = planned
    .filter((task) => !isDropped(verdicts.get(task.id)))
    .map((task) => withRelated(task, verdicts.get(task.id)));

  return { ...story, tasks };
}

function isDropped(verdict: DedupeVerdict | undefined): boolean {
  return verdict?.verdict === "duplicate_of" || verdict?.verdict === "done_in";
}

function withRelated(
  task: DecompTask,
  verdict: DedupeVerdict | undefined,
): DecompTask {
  return verdict?.verdict === "related"
    ? {
        ...task,
        description: `${task.description}\n\nRelated: #${verdict.ticket}`,
      }
    : task;
}

export function dedupeReport(report: DedupeVerdict[]): string {
  const lines = report.map((entry) =>
    entry.verdict === "search_failed"
      ? `- ${entry.taskId}: kept, search failed: ${entry.reason}`
      : `- ${entry.taskId}: ${entry.verdict} #${entry.ticket}`,
  );
  const body = lines.length
    ? lines.join("\n")
    : "No new task matched an existing ticket.";

  return `## Ticket dedupe\n\n${body}`;
}
