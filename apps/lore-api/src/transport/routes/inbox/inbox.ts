import { errorMessage } from "@re-cinq/lore-shared";
import type {
  Request,
  ResponseObject,
  ResponseToolkit,
  ServerRoute,
} from "@hapi/hapi";
import type { Pool } from "pg";
import { z } from "zod";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodResponse } from "../../http/zod-response.js";
import { withPool } from "../with-pool.js";

const InboxKindSchema = z.enum([
  "plan_review",
  "spec_pr",
  "triage",
  "onboarding_pr",
  "failed_run",
]);

type InboxKind = z.infer<typeof InboxKindSchema>;

const InboxItemSchema = z.object({
  id: z.string(),
  kind: InboxKindSchema,
  repo: z.string(),
  title: z.string(),
  detail: z.string().optional(),
  waiting_since: z.string(),
  open_url: z.string().nullable().optional(),
  state: z.string().optional(),
});

const InboxPageSchema = z.object({
  items: z.array(InboxItemSchema),
  counts: z.partialRecord(InboxKindSchema, z.number().int()),
  next_cursor: z.string().nullable(),
});

export function inboxRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "GET",
    path: "/api/inbox",
    options: zodResponse(bearerScope("read"), InboxPageSchema, {
      name: "InboxPage",
      description:
        "A page of inbox items aggregated from plan and onboarding sources",
    }),
    handler: withPool(getPool, serveInbox),
  };
}

async function serveInbox(
  pool: Pool,
  _request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  try {
    const inboxItems = await aggregateInboxItems(pool);

    return h.response({
      items: inboxItems,
      counts: countByKind(inboxItems),
      next_cursor: null,
    });
  } catch (err) {
    return h.response({ error: errorMessage(err) }).code(500);
  }
}

function countByKind(
  inboxItems: readonly { kind: InboxKind }[],
): Partial<Record<InboxKind, number>> {
  const counts: Partial<Record<InboxKind, number>> = {};

  for (const { kind } of inboxItems) {
    counts[kind] = (counts[kind] ?? 0) + 1;
  }

  return counts;
}

async function aggregateInboxItems(pool: Pool) {
  const [planRows, repoRows] = await Promise.all([
    pool.query(
      `SELECT id, repo, title, status, updated_at
       FROM lore.plans
       WHERE status = 'in-review'
       ORDER BY updated_at DESC`,
    ),
    pool.query(
      `SELECT id, full_name, onboarding_pr_url, onboarded_at
       FROM lore.repos
       WHERE onboarding_pr_merged = false
         AND onboarding_pr_url IS NOT NULL`,
    ),
  ]);

  return [
    ...planRows.rows.map(toPlanItem),
    ...repoRows.rows.map(toOnboardingItem),
  ].sort((a, b) => a.waiting_since.localeCompare(b.waiting_since));
}

function toPlanItem(row: Record<string, unknown>) {
  return {
    id: `plan:${row.id}`,
    kind: "plan_review" as const,
    repo: row.repo as string,
    title: row.title as string,
    waiting_since: (row.updated_at as Date).toISOString(),
    open_url: `/repos/${row.repo}/plans/${row.id}`,
    state: row.status as string,
  };
}

function toOnboardingItem(row: Record<string, unknown>) {
  return {
    id: `onboarding:${row.full_name}`,
    kind: "onboarding_pr" as const,
    repo: row.full_name as string,
    title: `Onboarding PR open for ${row.full_name}`,
    waiting_since: (row.onboarded_at as Date).toISOString(),
    open_url: row.onboarding_pr_url as string,
    state: "open",
  };
}
