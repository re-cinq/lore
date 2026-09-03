import "server-only";
import { apiFetch } from "./client";
import type { ApiResult } from "./result";
import type { components } from "./schema";

// Activity reads (memory audit, event bus, job runs, dashboard counts) — were direct SELECTs before lore-api grew these endpoints (ADR-032). Row types alias the OpenAPI schema; check-openapi-drift.sh guards staleness.
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

/** Repo dashboard's 7-day counters — an unanswerable figure is null, not zero, so an unmigrated cluster doesn't read as "nothing happened". */
export function getRepoActivityCounts(repo: string): Promise<
  ApiResult<{
    tasks: number | null;
    auto_merged: number | null;
    escalations: number | null;
  }>
> {
  return apiFetch("lore-api", `/api/repos/${repo}/activity-counts`);
}

/** Records money added to the Anthropic account — the only way the balance moves up, since the Admin API reports usage/cost but no credit balance. */
export function recordCreditEntry(entry: {
  amount_usd: number;
  effective_date?: string;
  /** Omitted anchors the entry to the start of its day — the safe direction when the clock is unknown. */
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

/** Distinct developers who've run a local session against this repo, and when the last one was; null when none. */
export function getRepoSessions(
  repo: string,
): Promise<ApiResult<{ devs: number; last: string | null }>> {
  return apiFetch("lore-api", `/api/repos/${repo}/sessions`);
}
