// Drops the new tasks an existing ticket already holds before the issues station files them (specs/spec-tickets FR27). The decision is ticket-dedupe's; this reads, searches and produces. A failed search keeps the task: dedupe never fails a run.
import {
  defineStation,
  type Handle,
  type RunningStation,
  type Tools,
} from "@re-cinq/floor-station";
import { eventLine } from "@re-cinq/lore-assembly-lines";
import { parseGitRef } from "@re-cinq/lore-shared/floor/floor-items.js";
import { parseDecomposition } from "@re-cinq/lore-shared/feature-planning/decomposition-result.js";
import { parseModelJson } from "@re-cinq/lore-shared/feature-planning/model-json.js";
import {
  searchTicketsOverHttp,
  type TicketSearchAnswer,
  type TicketSearchRequest,
} from "@re-cinq/lore-shared/project/lib/station-http.js";
import {
  dedupeDecomposition,
  dedupeReport,
  newTasks,
  ticketQuery,
  type OwnTickets,
  type TicketSearchOutcome,
} from "@re-cinq/lore-shared/spec-tickets/ticket-dedupe.js";
import type { DecompTask } from "@re-cinq/lore-shared/feature-planning/decomposition-result.js";
import type { TicketListing } from "../load-tickets/listing.js";

export interface DedupeDeps {
  search(request: TicketSearchRequest): Promise<TicketSearchAnswer>;
}

const SEARCH_LIMIT = 5;

export function dedupeHandle(deps: DedupeDeps): Handle {
  return async ({ needs }, tools) => {
    try {
      await dedupeVisit(deps, parseGitRef(needs.target).repo, tools);

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
  repo: string,
  tools: Tools,
): Promise<void> {
  const decomposition = parseDecomposition(
    parseModelJson(await readText(tools, "verified_decomposition")),
  );
  const own = ownTicketsOf(await readText(tools, "existing_tickets"));
  const tasks = newTasks(decomposition, own);
  const searched = await Promise.all(
    tasks.map((task) => searchOne(deps, repo, task)),
  );
  const result = dedupeDecomposition(decomposition, new Map(searched), own);

  await tools.produce(
    "deduped_decomposition",
    JSON.stringify(result.decomposition),
  );
  await tools.produce("dedupe_report", dedupeReport(result.report));
}

async function readText(tools: Tools, name: string): Promise<string> {
  return (await tools.read(name)).toString("utf8");
}

function ownTicketsOf(listing: string): OwnTickets {
  const tickets = JSON.parse(listing) as TicketListing[];

  return {
    ids: new Set(tickets.map((ticket) => ticket.id)),
    numbers: new Set(tickets.map((ticket) => ticket.number)),
  };
}

async function searchOne(
  deps: DedupeDeps,
  repo: string,
  task: DecompTask,
): Promise<[string, TicketSearchOutcome]> {
  const request = {
    repo,
    query: ticketQuery(task),
    state: "all" as const,
    limit: SEARCH_LIMIT,
  };
  const outcome = await deps
    .search(request)
    .catch((err: Error): TicketSearchOutcome => ({ error: err.message }));

  return [task.id, outcome];
}

export function startSpecTicketsDedupeStation(): RunningStation {
  return defineStation(
    "spec-tickets-dedupe",
    dedupeHandle({ search: (request) => searchTicketsOverHttp(request) }),
  );
}
