// Agents that file tickets search here first, so an open duplicate or a closed ticket for work already done is found before a new one is filed (specs/ticket-search).

import { z } from "zod";
import type { Pool } from "pg";
import type {
  Request,
  ResponseObject,
  ResponseToolkit,
  ServerRoute,
} from "@hapi/hapi";
import type { IssueRef, Project } from "@re-cinq/lore-shared";
import { UtopiaMirrorSettingsSchema } from "@re-cinq/lore-shared/models/repo-settings.js";
import { utopiaReadsFrom } from "@re-cinq/lore-shared/utopia/utopia-reads.js";
import { zodResponse } from "../../http/zod-response.js";
import { zodValidate } from "../../http/zod-validate.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { kindSourceFor } from "../../../outbound/utopia/kind-sources.js";
import {
  githubFailureResponse,
  onboardedProject,
} from "../repos/github-read.js";
import { ticketHitsOf, type TicketHit } from "./ticket-hits.js";

const MAX_LIMIT = 25;
const SEARCH_WINDOW = { topK: 50, offset: 0 };

const TicketStateSchema = z.enum(["open", "closed", "all"]);

const TicketSearchQuery = z.object({
  query: z.string().min(1),
  state: TicketStateSchema.default("all"),
  limit: z.coerce // eslint-disable-line re-lint/max-member-chain -- pipeline over a value already in hand
    .number()
    .int()
    .positive()
    .transform((n) => Math.min(n, MAX_LIMIT))
    .default(10),
});

type TicketSearchQuery = z.infer<typeof TicketSearchQuery>;

// A GitHub read joined to a Utopia search, so this shape is stated rather than derived.
const TicketSearchResultSchema = z.object({
  tickets: z.array(
    z.object({
      number: z.number(),
      title: z.string(),
      state: z.enum(["open", "closed"]),
      labels: z.array(z.string()),
      url: z.string().nullable(),
      score: z.number(),
      excerpt: z.string(),
    }),
  ),
  /** Why nothing could be searched, e.g. "search_tickets: re-cinq/lore has no Utopia base". */
  notes: z.array(z.string()).optional(),
});

type TicketSearchResult = z.infer<typeof TicketSearchResultSchema>;

type Ticket = TicketSearchResult["tickets"][number];

const RepoParams = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
});

const ROUTE_OPTIONS = zodResponse(
  {
    ...bearerScope("read"),
    validate: {
      params: zodValidate(RepoParams),
      query: zodValidate(TicketSearchQuery),
    },
  },
  TicketSearchResultSchema,
  {
    name: "TicketSearchResults",
    description:
      "The repo's GitHub issues, open and closed, that best match a query, highest-scoring first, with their current state from GitHub",
    errors: [400, 404],
  },
);

export function ticketSearchRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "GET",
    path: "/api/repos/{owner}/{repo}/tickets/search",
    options: ROUTE_OPTIONS,
    handler: (request, h) => serveTicketSearch(getPool(), request, h),
  };
}

async function serveTicketSearch(
  pool: Pool | null,
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const { owner, repo } = request.params as { owner: string; repo: string };

  try {
    return h.response(
      await ticketSearchAnswer(
        pool,
        `${owner}/${repo}`,
        request.query as TicketSearchQuery,
      ),
    );
  } catch (err) {
    return githubFailureResponse(err, h, "issues");
  }
}

async function ticketSearchAnswer(
  pool: Pool | null,
  repo: string,
  search: TicketSearchQuery,
): Promise<TicketSearchResult> {
  const project = await onboardedProject(repo);
  const hits = await issueHitsOf(pool, project, repo, search.query);

  return hits === null
    ? { tickets: [], notes: [`search_tickets: ${repo} has no Utopia base`] }
    : { tickets: await currentTickets(project, hits, search) };
}

/** Null when the repo has no knowledge base with an `issues` source, or the deployment no Utopia to read. */
async function issueHitsOf(
  pool: Pool | null,
  project: Project,
  repo: string,
  query: string,
): Promise<TicketHit[] | null> {
  const mirror = UtopiaMirrorSettingsSchema.safeParse(
    (await project.settings.rawSettings())?.utopia,
  );
  const issuesSource = pool && (await kindSourceFor(pool, repo, "issues"));
  const reads = utopiaReadsFrom(process.env);

  if (!mirror.success || !issuesSource || !reads) {
    return null;
  }
  const page = await reads.search(mirror.data.kb_id, query, SEARCH_WINDOW);

  return ticketHitsOf(page.hits, issuesSource.id);
}

/** Utopia's copy of an issue lags GitHub, so the state filter is applied to what GitHub says now. */
async function currentTickets(
  project: Project,
  hits: TicketHit[],
  { state, limit }: TicketSearchQuery,
): Promise<Ticket[]> {
  const candidates = state === "all" ? hits.slice(0, limit) : hits;
  const issues = await Promise.all(
    candidates.map((hit) => project.issues.get(hit.number)),
  );

  return candidates
    .map((hit, index) => issues[index] && toTicket(hit, issues[index]))
    .filter((ticket): ticket is Ticket => !!ticket)
    .filter((ticket) => state === "all" || ticket.state === state)
    .slice(0, limit);
}

function toTicket(hit: TicketHit, issue: IssueRef): Ticket {
  return {
    number: hit.number,
    title: issue.title,
    state: issue.state,
    labels: issue.labels,
    url: issue.url ?? null,
    score: hit.score,
    excerpt: hit.excerpt,
  };
}
