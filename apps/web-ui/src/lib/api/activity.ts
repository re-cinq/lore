import "server-only";
import { apiFetch } from "./client";
import type { ApiResult } from "./result";
import type { components } from "./schema";

// The activity reads — memory audit, the event bus, job runs, and a repo's
// dashboard counts. Each was a direct SELECT in a page body before lore-api
// grew the endpoints (ADR-032).

// None of these row shapes is restated here. Each is an alias over the OpenAPI
// document lore-api generates from its route contracts (ADR-035), and those
// contracts are themselves derived from the shared models plus their column
// maps — so a column, its contract and this type have ONE declaration between
// them, and check-openapi-drift.sh fails CI when the generated artifact is stale.

export type MemoryAuditEntry =
  components["schemas"]["MemoryAuditPage"]["entries"][number];

export type RepoEventRow =
  components["schemas"]["RepoEventList"]["events"][number];

export type JobRunRow = components["schemas"]["JobRun"];

/** A page of memory-audit entries plus the unpaged total the pager needs. */
export function getMemoryAudit(opts: {
  agent?: string;
  operation?: string;
  zeroResults?: boolean;
  limit?: number;
  offset?: number;
}): Promise<ApiResult<{ entries: MemoryAuditEntry[]; total: number }>> {
  const params = new URLSearchParams();

  if (opts.agent?.trim()) {
    params.set("agent", opts.agent.trim());
  }

  if (opts.operation?.trim()) {
    params.set("operation", opts.operation.trim());
  }

  if (opts.zeroResults) {
    params.set("zero_results", "true");
  }
  params.set("limit", String(opts.limit ?? 50));
  params.set("offset", String(opts.offset ?? 0));

  return apiFetch("lore-api", `/api/memory-audit?${params}`);
}

/** A repo's event-bus rows, newest first. */
export function getRepoEvents(
  repo: string,
  limit: number,
  offset = 0,
): Promise<ApiResult<{ events: RepoEventRow[] }>> {
  const params = new URLSearchParams({
    repo,
    limit: String(limit),
    offset: String(offset),
  });

  return apiFetch("lore-api", `/api/events?${params}`);
}

export function getJobRun(id: string): Promise<ApiResult<JobRunRow>> {
  return apiFetch("lore-api", `/api/job-runs/${encodeURIComponent(id)}`);
}

/** The repo dashboard's 7-day counters. A figure the database could not answer
 *  is null, not zero — an unmigrated cluster must not read as "nothing
 *  happened". */
export function getRepoActivityCounts(repo: string): Promise<
  ApiResult<{
    tasks: number | null;
    auto_merged: number | null;
    escalations: number | null;
  }>
> {
  return apiFetch("lore-api", `/api/repos/${repo}/activity-counts`);
}

/** The whole spend screen: billed figures from the daily Anthropic sync, Lore's
 *  own computed figures, and every month-to-date breakdown they render with.
 *  `org_available` is false when the sync has never run — the view hides the
 *  billed sections rather than showing a confident zero. */
/** What is left of the recorded balance, or null when nobody has recorded one.
 *  Aliased off the generated contract rather than restated — the neighbouring
 *  `Record<string, unknown>` entries predate that document. */
export type SpendBudget = components["schemas"]["Spend"]["budget"];

export function getSpend(): Promise<
  ApiResult<{
    budget: SpendBudget;
    org_available: boolean;
    org_mtd: Record<string, unknown>;
    org_by_model: Record<string, unknown>[];
    org_daily: Record<string, unknown>[];
    lore_unbilled_usd: number;
    lore_unbilled_days: number;
    lore_mtd: Record<string, unknown>;
    lore_by_model: Record<string, unknown>[];
    lore_by_kind: Record<string, unknown>[];
    lore_daily: Record<string, unknown>[];
    lore_by_repo: Record<string, unknown>[];
    lore_by_task_type: Record<string, unknown>[];
  }>
> {
  return apiFetch("lore-api", "/api/spend");
}

/**
 * Record money added to the Anthropic account. The one write on this screen,
 * and the only way the remaining figure ever moves upward — Anthropic's Admin
 * API reports usage and cost but exposes no credit balance, so a top-up is
 * invisible until someone says it happened.
 */
export function recordCreditEntry(entry: {
  amount_usd: number;
  effective_date?: string;
  /** Omitted anchors the entry to the start of its day, which counts the whole
   *  day against the balance — the safe direction when the clock is unknown. */
  effective_time?: string;
  kind?: "opening" | "topup" | "correction";
  note?: string;
  recorded_by?: string;
}): Promise<ApiResult<components["schemas"]["CreditEntryRecorded"]>> {
  return apiFetch("lore-api", "/api/spend/credits", {
    method: "POST",
    body: entry,
  });
}

/** The analytics screen's six reads in one call. */
export function getAnalyticsOverview(): Promise<
  ApiResult<{
    task_summary: Record<string, unknown> | null;
    usage_by_task_type: Record<string, unknown>[];
    usage_by_repo: Record<string, unknown>[];
    daily_usage: Record<string, unknown>[];
    latency_stats: Record<string, unknown>[];
    job_runs: Record<string, unknown>[];
  }>
> {
  return apiFetch("lore-api", "/api/analytics-overview");
}

/** How many distinct developers have run a local session against this repo, and
 *  when the last one was. Null when the repo has none. */
export function getRepoSessions(
  repo: string,
): Promise<ApiResult<{ devs: number; last: string | null }>> {
  return apiFetch("lore-api", `/api/repos/${repo}/sessions`);
}
