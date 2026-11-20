// Drops the new tasks an existing ticket already holds before the issues station files them (specs/spec-tickets FR30). The search picks candidates, a model judges them, ticket-dedupe applies the verdicts. A failed search or judge keeps the task: dedupe never fails a run.
import {
  defineStation,
  type Brief,
  type Handle,
  type RunningStation,
  type Tools,
} from "@re-cinq/floor-station";
import { eventLine } from "@re-cinq/lore-assembly-lines";
import { parseGitRef } from "@re-cinq/lore-shared/floor/floor-items.js";
import {
  parseDecomposition,
  type DecompTask,
} from "@re-cinq/lore-shared/feature-planning/decomposition-result.js";
import { parseModelJson } from "@re-cinq/lore-shared/feature-planning/model-json.js";
import { Llm } from "@re-cinq/lore-shared/llm/llm.js";
import type { LlmToolResult } from "@re-cinq/lore-shared/llm/llm-provider.js";
import {
  searchTicketsOverHttp,
  type TicketSearchAnswer,
  type TicketSearchRequest,
} from "@re-cinq/lore-shared/project/lib/station-http.js";
import {
  applyJudgements,
  candidatesOf,
  dedupeReport,
  judgePrompt,
  JUDGE_TOOL_SCHEMA,
  newTasks,
  ticketQuery,
  type OwnTickets,
  type TaskJudgement,
} from "@re-cinq/lore-shared/spec-tickets/ticket-dedupe.js";
import { specFilingKey } from "@re-cinq/lore-shared/spec-tickets/floor-spec-tickets.js";
import type { PlanIssues } from "@re-cinq/lore-shared/feature-planning/plan-issues.js";
import { projectFor } from "../../outbound/project-boot.js";
import { existingPlanIssues } from "../../planning/file-issues/plan-issue-filing.js";
import type { TicketListing } from "../load-tickets/listing.js";

export interface DedupeDeps {
  /** The story and task issues filed for the spec so far, this run's earlier rounds included. */
  filed(repo: string, filingKey: string): Promise<PlanIssues>;
  search(request: TicketSearchRequest): Promise<TicketSearchAnswer>;
  judge(prompt: string): Promise<LlmToolResult<unknown>>;
}

const LLM_USE = "ticket_dedupe";
const SEARCH_LIMIT = 5;
const JUDGES_AT_ONCE = 4;

const productionDeps: DedupeDeps = {
  filed: async (repo, filingKey) =>
    existingPlanIssues(await projectFor(repo), filingKey),
  search: (request) => searchTicketsOverHttp(request),
  judge: (prompt) =>
    Llm.for(LLM_USE).completeWithTool<unknown>({
      prompt,
      jobName: LLM_USE,
      temperature: 0,
      maxTokens: 400,
      toolName: "ticket_dedupe",
      toolDescription:
        "Whether an existing ticket already covers the task, which one, and why.",
      toolSchema: JUDGE_TOOL_SCHEMA,
    }),
};

interface Visit {
  deps: DedupeDeps;
  repo: string;
  own: OwnTickets;
  tools: Tools;
}

export function dedupeHandle(deps: DedupeDeps): Handle {
  return async ({ needs }, tools) => {
    try {
      await dedupeVisit(deps, needs, tools);

      return { outcome: "success" };
    } catch (err) {
      const message = (err as Error).message;

      console.log(eventLine(`spec-tickets-dedupe failed: ${message}`));

      return { outcome: "failed", error: message };
    }
  };
}

async function dedupeVisit(
  deps: DedupeDeps,
  needs: Brief["needs"],
  tools: Tools,
): Promise<void> {
  const { repo } = parseGitRef(needs.target);
  const decomposition = parseDecomposition(
    parseModelJson(await readText(tools, "verified_decomposition")),
  );
  const own = await ownTicketsOf(deps, repo, needs.spec_path, tools);
  const visit = { deps, repo, own, tools };
  const judged = await pooled(newTasks(decomposition, own), (task) =>
    judgementOf(visit, task),
  );
  const result = applyJudgements(decomposition, new Map(judged.flat()));

  await tools.produce(
    "deduped_decomposition",
    JSON.stringify(result.decomposition),
  );
  await tools.produce("dedupe_report", dedupeReport(result.report));
}

async function readText(tools: Tools, name: string): Promise<string> {
  return (await tools.read(name)).toString("utf8");
}

// Read at this visit, not from the load step's file: a round sent back to decompose files tickets the load step never saw, and a task judged a duplicate of its own ticket closes it.
async function ownTicketsOf(
  deps: DedupeDeps,
  repo: string,
  specPath: string | undefined,
  tools: Tools,
): Promise<OwnTickets> {
  // A line version that hands this step no spec_path has only the load step's listing.
  if (!specPath) {
    return listedTickets(await readText(tools, "existing_tickets"));
  }
  const { story, tasks } = await deps.filed(repo, specFilingKey(specPath));
  const issues = [...tasks.values(), ...(story ? [story] : [])];

  return {
    ids: new Set(tasks.keys()),
    numbers: new Set(issues.map((issue) => issue.number)),
  };
}

function listedTickets(listing: string): OwnTickets {
  const tickets = JSON.parse(listing) as TicketListing[];

  return {
    ids: new Set(tickets.map((ticket) => ticket.id)),
    numbers: new Set(tickets.map((ticket) => ticket.number)),
  };
}

type Judged = [string, TaskJudgement];

/** A task with no candidate gets no judgement and stays as it is. */
async function judgementOf(visit: Visit, task: DecompTask): Promise<Judged[]> {
  const searched = await searchFor(visit, task);

  if ("failed" in searched) {
    return [[task.id, searched]];
  }
  const candidates = candidatesOf(searched, visit.own);

  return candidates.length
    ? [[task.id, await judged(visit, task, candidates)]]
    : [];
}

async function searchFor(
  { deps, repo }: Visit,
  task: DecompTask,
): Promise<TicketSearchAnswer | { failed: "search_failed"; reason: string }> {
  const request = { repo, query: ticketQuery(task), state: "all" as const };

  try {
    const answer = await deps.search({ ...request, limit: SEARCH_LIMIT });
    const notes = answer.notes ?? [];

    return notes.length
      ? { failed: "search_failed", reason: notes.join("; ") }
      : answer;
  } catch (err) {
    return { failed: "search_failed", reason: (err as Error).message };
  }
}

async function judged(
  visit: Visit,
  task: DecompTask,
  candidates: ReturnType<typeof candidatesOf>,
): Promise<TaskJudgement> {
  try {
    const answer = await visit.deps.judge(judgePrompt(task, candidates));

    await visit.tools.modelCall(modelCallOf(answer));

    return { candidates, answer: answer.parsed };
  } catch (err) {
    return { failed: "judge_failed", reason: (err as Error).message };
  }
}

function modelCallOf(answer: LlmToolResult<unknown>) {
  return {
    model: answer.model,
    costUsd: answer.costUsd,
    usage: {
      input_tokens: answer.inputTokens,
      cache_read_input_tokens: answer.cacheReadTokens,
      output_tokens: answer.outputTokens,
    },
  };
}

/** Judges JUDGES_AT_ONCE tasks at a time, keeping their order. */
async function pooled<T, R>(
  tasks: T[],
  work: (task: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    for (let index = next++; index < tasks.length; index = next++) {
      results[index] = await work(tasks[index] as T);
    }
  };

  await Promise.all(Array.from({ length: JUDGES_AT_ONCE }, worker));

  return results;
}

export function startSpecTicketsDedupeStation(): RunningStation {
  return defineStation("spec-tickets-dedupe", dedupeHandle(productionDeps));
}
