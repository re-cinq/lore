import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { textResult, proxyGetApi } from "../shared/deps.js";
import { proxyRefusal } from "../shared/render-proxied.js";
import { repoParam, withRepo, type ServerMode } from "../shared/repo-scope.js";
import { apiAnswer, type ApiAnswer } from "../../api/api-types.js";

const MAX_LIMIT = 25;

const SEARCH_TICKETS_INPUT = {
  query: z
    .string()
    .min(1)
    .describe(
      "What the ticket you are about to file is about, in plain words (its title and the gist of its body).",
    ),
  state: z
    .enum(["open", "closed", "all"])
    .default("all")
    .describe(
      "open finds duplicates, closed finds work already done; all (default) finds both.",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_LIMIT)
    .default(10)
    .describe(`Most tickets to return (default 10, max ${MAX_LIMIT}).`),
};

type TicketSearch = {
  repo: string;
  query: string;
  state: "open" | "closed" | "all";
  limit: number;
};

const TICKETS_PATH = "/api/repos/{owner}/{repo}/tickets/search";

type Tickets = ApiAnswer<typeof TICKETS_PATH>;

const TICKETS_READ = {
  op: "searching tickets",
  subject: "tickets",
  toolName: "lore_search_tickets",
};

export function registerSearchTicketsTool(server: McpServer, mode: ServerMode) {
  server.tool(
    "lore_search_tickets",
    `Fuzzy search over the repo's GitHub issues, open AND closed, ranked by relevance, with each issue's current state from GitHub. Call it BEFORE filing any ticket: an open match is a duplicate (comment on it or skip filing), a closed match is work already done (do not file it again). One line per ticket: #N [state] title (score) url, then an excerpt.`,
    { ...SEARCH_TICKETS_INPUT, repo: repoParam(mode) },
    (args) => withRepo(args, mode, searchTickets),
  );
}

async function searchTickets({ repo, query, state, limit }: TicketSearch) {
  const params = new URLSearchParams({
    query,
    state,
    limit: String(limit),
  });
  const proxied = await proxyGetApi(
    `/api/repos/${repo}/tickets/search?${params}`,
  );

  if (!proxied.ok) {
    return proxyRefusal(proxied, TICKETS_READ);
  }

  return renderTickets(query, apiAnswer(TICKETS_PATH, proxied.body));
}

function renderTickets(query: string, { tickets, notes = [] }: Tickets) {
  const listing =
    tickets.length > 0
      ? tickets.map(ticketLines).join("\n\n")
      : `No tickets match "${query}".`;

  return textResult([listing, ...notes].join("\n\n"));
}

function ticketLines(ticket: Tickets["tickets"][number]): string {
  const heading = `#${ticket.number} [${ticket.state}] ${ticket.title} (${ticket.score.toFixed(3)}) ${ticket.url ?? ""}`;

  return `${heading.trimEnd()}\n    ${ticket.excerpt}`;
}
