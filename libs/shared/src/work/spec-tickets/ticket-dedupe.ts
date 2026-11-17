// Drops the new tasks of a spec's decomposition that an existing ticket already holds, before the issues station files them (specs/spec-tickets FR30). The search score only picks candidates; a model judges them. Pure: the station searches and asks the model, this chooses and applies.
import { z } from "zod";
import type {
  DecompTask,
  DecompositionResult,
  UserStory,
} from "../../domain/feature-planning/decomposition-result.js";

// Calibrated 2026-11-17 on 178 bot tickets: scores are reciprocal-rank-fusion, ~0.016–0.033; at 0.026 about a quarter of both useful and useless tickets had an earlier match, so the score only picks candidates and a model judges.
export const CANDIDATE_SCORE = 0.026;

const MAX_CANDIDATES = 5;
const QUERY_DESCRIPTION_LENGTH = 200;

export interface TicketMatch {
  number: number;
  title: string;
  state: "open" | "closed";
  score: number;
  excerpt: string;
}

export interface TicketSearchOutcome {
  tickets: TicketMatch[];
  notes?: string[];
}

/** The tickets an earlier run filed for this spec: their task ids are rewrites, their numbers are never candidates. */
export interface OwnTickets {
  ids: ReadonlySet<string>;
  numbers: ReadonlySet<number>;
}

type Failure = "search_failed" | "judge_failed";

/** What the station learned about one new task: the candidates and the model's raw answer, or why it learned nothing. */
export type TaskJudgement =
  | { candidates: TicketMatch[]; answer: unknown }
  | { failed: Failure; reason: string };

export type DedupeVerdict =
  | {
      taskId: string;
      verdict: "duplicate_of" | "done_in" | "related";
      ticket: number;
      why: string;
    }
  | { taskId: string; verdict: "new"; why: string }
  | { taskId: string; verdict: Failure; reason: string };

export interface DedupeResult {
  decomposition: DecompositionResult;
  report: DedupeVerdict[];
}

const judgeAnswerSchema = z.object({
  verdict: z.enum(["duplicate", "done", "related", "new"]),
  ticket: z.number().int().positive().optional(),
  why: z.string(),
});

type JudgeAnswer = z.infer<typeof judgeAnswerSchema>;

export const JUDGE_TOOL_SCHEMA = {
  type: "object",
  properties: {
    verdict: {
      type: "string",
      enum: ["duplicate", "done", "related", "new"],
      description:
        "duplicate: an open ticket already asks for this work; done: a closed ticket already did it; related: a ticket touches it but the task is still needed; new: none does.",
    },
    ticket: {
      type: "integer",
      description: "The candidate's number, for duplicate, done or related.",
    },
    why: {
      type: "string",
      description: "One sentence on what the ticket and the task share or not.",
    },
  },
  required: ["verdict", "why"],
} as const;

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
  const description = task.description.slice(0, QUERY_DESCRIPTION_LENGTH);

  return `${title}\n${description}`.trim();
}

/** The best tickets, not this spec's own, that score enough to be worth a judge, at most five. */
export function candidatesOf(
  search: TicketSearchOutcome,
  own: OwnTickets,
  minScore = CANDIDATE_SCORE,
): TicketMatch[] {
  const others = search.tickets.filter(
    (ticket) => !own.numbers.has(ticket.number) && ticket.score >= minScore,
  );
  const ranked = [...others].sort((a, b) => b.score - a.score);

  return ranked.slice(0, MAX_CANDIDATES);
}

export function judgePrompt(
  task: DecompTask,
  candidates: TicketMatch[],
): string {
  const criteria = (task.acceptance_criteria ?? []).map((line) => `- ${line}`);
  const tickets = candidates.map(
    (ticket) =>
      `#${ticket.number} [${ticket.state}] ${ticket.title}\n${ticket.excerpt}`,
  );

  return [
    "A spec's decomposition is about to file the task below as a new GitHub issue. Decide whether one of the existing tickets already covers it.",
    "Answer duplicate when an open ticket asks for the same work, done when a closed ticket already did it, related when a ticket touches the work but the task is still needed, new when none does. Name the ticket for duplicate, done and related.",
    `## Task\n\n${task.title ?? ""}\n\n${task.description}`,
    `## Acceptance criteria\n\n${criteria.join("\n") || "(none)"}`,
    `## Existing tickets\n\n${tickets.join("\n\n")}`,
  ].join("\n\n");
}

export function parseJudgeAnswer(raw: unknown): JudgeAnswer | null {
  const parsed = judgeAnswerSchema.safeParse(raw);

  return parsed.success ? parsed.data : null;
}

export function applyJudgements(
  decomposition: DecompositionResult,
  judgements: ReadonlyMap<string, TaskJudgement>,
): DedupeResult {
  const verdicts = new Map(
    [...judgements].map(([taskId, judgement]) => [
      taskId,
      verdictOf(taskId, judgement),
    ]),
  );
  const kept = decomposition.stories.map((story) => keptStory(story, verdicts));
  const stories = kept.filter((story) => story.tasks.length > 0);

  return {
    decomposition: { ...decomposition, stories },
    report: [...verdicts.values()],
  };
}

function verdictOf(taskId: string, judgement: TaskJudgement): DedupeVerdict {
  if ("failed" in judgement) {
    return { taskId, verdict: judgement.failed, reason: judgement.reason };
  }
  const answer = parseJudgeAnswer(judgement.answer);

  return answer
    ? resolvedVerdict(taskId, answer, judgement.candidates)
    : {
        taskId,
        verdict: "judge_failed",
        reason: `unreadable answer: ${JSON.stringify(judgement.answer)}`,
      };
}

const DROP_STATE = { duplicate: "open", done: "closed" } as const;
const DROP_VERDICT = { duplicate: "duplicate_of", done: "done_in" } as const;

// A drop needs the named candidate in the state its verdict claims; anything less is only a related ticket.
function resolvedVerdict(
  taskId: string,
  { verdict, ticket, why }: JudgeAnswer,
  candidates: TicketMatch[],
): DedupeVerdict {
  if (verdict === "new" || ticket === undefined) {
    return { taskId, verdict: "new", why };
  }
  const named = candidates.find((candidate) => candidate.number === ticket);
  const drops = verdict !== "related" && named?.state === DROP_STATE[verdict];

  return drops
    ? { taskId, verdict: DROP_VERDICT[verdict], ticket, why }
    : { taskId, verdict: "related", ticket, why };
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
  const lines = report.map(reportLine);
  const body = lines.length
    ? lines.join("\n")
    : "No new task matched an existing ticket.";

  return `## Ticket dedupe\n\n${body}`;
}

function reportLine(entry: DedupeVerdict): string {
  if ("reason" in entry) {
    return `- ${entry.taskId}: kept, ${entry.verdict}: ${entry.reason}`;
  }

  return entry.verdict === "new"
    ? `- ${entry.taskId}: new — ${entry.why}`
    : `- ${entry.taskId}: ${entry.verdict} #${entry.ticket} — ${entry.why}`;
}
