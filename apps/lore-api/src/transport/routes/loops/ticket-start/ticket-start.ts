// A person starts one named ticket of the implementation loop now (specs/implementation-loop): the route answers the guards at once and writes `loop.ticket.start`, which the stations drain turns into the ticket's run, outside `implementation_loop.max_parallel`.
import type { Pool } from "pg";
import type {
  Request,
  ResponseObject,
  ResponseToolkit,
  ServerRoute,
} from "@hapi/hapi";
import { z } from "zod";
import { ticketGuardPortsOf } from "@re-cinq/lore-shared/backlog/driver-ports.js";
import { openRunOfTicket } from "@re-cinq/lore-shared/backlog/floor-loop.js";
import {
  floorClient,
  floorConfigured,
} from "@re-cinq/lore-shared/floor/floor-client.js";
import { PgSettings } from "@re-cinq/lore-shared/project/settings/settings-pg.js";
import { bearerScope } from "../../../http/bearer-scope.js";
import { repoLevel } from "../../../http/repo-guard.js";
import { zodResponse } from "../../../http/zod-response.js";
import { zodValidate } from "../../../http/zod-validate.js";
import { projectFor } from "../../../../outbound/project-boot.js";
import { pipelineRepositories } from "../../../../outbound/pipeline-boot.js";
import { eventReporterFor } from "../../event-reporter.js";
import { OkTrue } from "../../../http/ok-schema.js";
import { withPool } from "../../with-pool.js";
import {
  requestTicketStart,
  type TicketStartDeps,
} from "./ticket-start-decision.js";

const IssueNumber = z.coerce.number();

const PARAMS = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  issue: IssueNumber.int().min(1),
});

const ResultSchema = z.object({
  ok: OkTrue,
  issue_number: z.number(),
});

const OPTIONS = zodResponse(
  {
    ...bearerScope("admin"),
    ...repoLevel("admin"),
    validate: { params: zodValidate(PARAMS) },
  },
  ResultSchema,
  {
    name: "LoopTicketStart",
    description:
      "Start one named ticket of the implementation loop now, beside the runs it already has and outside implementation_loop.max_parallel. The ticket still passes the loop's guards: the loop is on and not paused, the repository is onboarded, the issue is open, has no active task and no open blocker. A refused ticket answers 409 naming the guard; one already running answers 409 with its run_id.",
    errors: [400, 409],
  },
);

export function ticketStartRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "POST",
    path: "/api/repos/{owner}/{repo}/loops/implementation/tickets/{issue}/start",
    options: OPTIONS,
    handler: withPool(getPool, serveTicketStart),
  };
}

async function serveTicketStart(
  pool: Pool,
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const { owner, repo, issue } = request.params as unknown as z.infer<
    typeof PARAMS
  >;
  const { status, body } = await requestTicketStart(
    depsFor(pool),
    `${owner}/${repo}`,
    issue,
  );

  return h.response(body).code(status);
}

function depsFor(pool: Pool): TicketStartDeps {
  return {
    guards: ticketGuardPortsOf({
      settings: new PgSettings(pool),
      taskQueue: pipelineRepositories().taskQueue,
      projectOf: projectFor,
    }),
    openRunOf: async (repo, issueNumber) =>
      floorConfigured()
        ? openRunOfTicket(floorClient(), repo, issueNumber)
        : null,
    report: eventReporterFor(pool),
  };
}
