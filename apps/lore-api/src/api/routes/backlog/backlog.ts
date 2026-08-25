import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import type { IssueRef } from "@re-cinq/lore-shared";
import { orderBacklog, PRIORITY_LABELS } from "@re-cinq/lore-shared";
import { OPEN_TASK_STATES } from "@re-cinq/lore-shared/project/tasks/task-store-port.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "../../../server/api-error.js";
import { projectFor } from "../../../platform/project-boot.js";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
import { zodResponse } from "../../../server/plugins/zod-response.js";
import { zodValidate } from "../../../server/plugins/zod-validate.js";
import { DB_UNAVAILABLE } from "../common-schemas.js";
import {
  ImplementationLoopSchema,
  ToggleBodySchema,
  ToggleResultSchema,
  type Ticket,
} from "./backlog-schema.js";

/**
 * `/api/repos/{owner}/{repo}/implementation-loop` — the backlog loop's repo
 * surface (implementation-loop FR10). GET (`read`) returns the toggle, the
 * ticket being worked, the ordered queue, and recently addressed tickets; PUT
 * (`admin`) flips the toggle. The toggle is deliberately NOT a dark-factory
 * privileged field — the loop never merges — so the write is a plain settings
 * merge with no CODEOWNER ceremony (FR7).
 */

const PATH = "/api/repos/{owner}/{repo}/implementation-loop";

const repoOf = (p: Record<string, string>) => `${p.owner}/${p.repo}`;

interface LoopTaskRow {
  status: string;
  description: string;
  issue_number: number | null;
  issue_url: string | null;
  pr_url: string | null;
}

const priorityOf = (issue: IssueRef | undefined): string | null =>
  issue?.labels.find((l) =>
    (PRIORITY_LABELS as readonly string[]).includes(l),
  ) ?? null;

function taskTicket(
  row: LoopTaskRow,
  openIssues: readonly IssueRef[],
): Ticket | null {
  if (!row.issue_number) {
    return null;
  }
  const issue = openIssues.find((i) => i.number === row.issue_number);

  return {
    issue_number: row.issue_number,
    issue_url: row.issue_url,
    title: issue?.title ?? row.description.split("\n")[0] ?? "",
    priority: priorityOf(issue),
    pr_url: row.pr_url,
    state: row.status,
  };
}

export function implementationLoopRoutes(
  getPool: () => Pool | null,
): ServerRoute[] {
  return [
    {
      method: "GET",
      path: PATH,
      options: zodResponse(bearerScope("read"), ImplementationLoopSchema, {
        name: "ImplementationLoop",
        description:
          "The repo's backlog loop: toggle state, the ticket being worked, the ordered queue, and recently addressed tickets.",
      }),
      handler: async (request, h) => {
        const pool = getPool();

        enforceTrue(pool, apiError(503), DB_UNAVAILABLE);
        const repo = repoOf(request.params);
        const { rows } = await pool.query<{
          settings: Record<string, unknown> | null;
        }>("SELECT settings FROM lore.repos WHERE full_name = $1", [repo]);

        enforceTrue(rows.length > 0, apiError(404), `repo not found: ${repo}`);
        const settings = rows[0].settings ?? {};
        const enabled =
          (settings as { implementation_loop?: { enabled?: unknown } })
            .implementation_loop?.enabled === true;
        const { rows: taskRows } = await pool.query<LoopTaskRow>(
          `SELECT status, description, issue_number, issue_url, pr_url
             FROM pipeline.tasks
            WHERE target_repo = $1 AND task_type = 'implementation-loop'
            ORDER BY created_at DESC
            LIMIT 20`,
          [repo],
        );
        const openIssues = await (
          await projectFor(repo)
        ).issues.list({ state: "open" });
        const currentRow = taskRows.find((t) =>
          (OPEN_TASK_STATES as readonly string[]).includes(t.status),
        );
        const current = currentRow ? taskTicket(currentRow, openIssues) : null;
        const next = orderBacklog(openIssues)
          .filter((i) => i.number !== current?.issue_number)
          .map((i) => ({
            issue_number: i.number,
            issue_url: i.url ?? null,
            title: i.title,
            priority: priorityOf(i),
            pr_url: null,
            state: "queued",
          }));
        const recent = taskRows
          .filter((t) => t !== currentRow)
          .filter(
            (t) => !(OPEN_TASK_STATES as readonly string[]).includes(t.status),
          )
          .slice(0, 10)
          .map((t) => taskTicket(t, openIssues))
          .filter((t): t is Ticket => t !== null);

        return h.response({ enabled, current, next, recent }).code(200);
      },
    },
    {
      method: "PUT",
      path: PATH,
      options: zodResponse(
        {
          ...bearerScope("admin"),
          validate: { payload: zodValidate(ToggleBodySchema) },
        },
        ToggleResultSchema,
        {
          name: "ImplementationLoopToggle",
          description: "Enable or disable the repo's backlog loop.",
        },
      ),
      handler: async (request, h) => {
        const pool = getPool();

        enforceTrue(pool, apiError(503), DB_UNAVAILABLE);
        const repo = repoOf(request.params);
        const { enabled } = request.payload as { enabled: boolean };
        const { rows } = await pool.query<{ full_name: string }>(
          "SELECT full_name FROM lore.repos WHERE full_name = $1",
          [repo],
        );

        enforceTrue(rows.length > 0, apiError(404), `repo not found: ${repo}`);
        await pool.query(
          `UPDATE lore.repos
              SET settings = COALESCE(settings, '{}'::jsonb)
                || jsonb_build_object('implementation_loop',
                     COALESCE(settings->'implementation_loop', '{}'::jsonb)
                       || jsonb_build_object('enabled', $2::boolean))
            WHERE full_name = $1`,
          [repo, enabled],
        );

        return h.response({ ok: true as const, enabled }).code(200);
      },
    },
  ];
}
