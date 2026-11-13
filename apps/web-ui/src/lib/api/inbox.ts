import "server-only";
import { apiFetch } from "./client";
import type { ApiResult } from "./result";

export type InboxKind =
  "failed_run" | "plan_review" | "spec_pr" | "backlog_pr" | "triage_issue";

export interface InboxAction {
  kind: "retry" | "approve_plan" | "rework_spec" | "merge";
  label: string;
}

export interface InboxEntry {
  id: string;
  kind: InboxKind;
  repo: string;
  title: string;
  detail: string;
  waiting_since: string;
  open_url: string;
  actions: InboxAction[];
  state: {
    handled_at?: string;
    handled_by?: string;
    snoozed_until?: string;
  };
}

export interface InboxResponse {
  items: InboxEntry[];
  counts: Partial<Record<InboxKind, number>>;
  next_cursor: string | null;
  unavailable?: string[];
}

export interface InboxQuery {
  repo?: string;
  kind?: readonly InboxKind[];
  include?: "snoozed" | "handled";
  cursor?: string;
}

const READ_TIMEOUT_MS = 5000;

export function getInbox(
  query: InboxQuery = {},
): Promise<ApiResult<InboxResponse>> {
  return apiFetch("lore-api", inboxPath(query), {
    timeoutMs: READ_TIMEOUT_MS,
  });
}

/** Sum of every kind's open count in `/api/inbox`'s `counts` map (specs/inbox FR1.5, FR5.1). */
export function openInboxCount(
  counts: Partial<Record<InboxKind, number>>,
): number {
  let sum = 0;

  for (const count of Object.values(counts)) {
    if (typeof count === "number") {
      sum += count;
    }
  }

  return sum;
}

function inboxPath(query: InboxQuery): string {
  const params = new URLSearchParams();

  setOptionalParam(params, "repo", query.repo);

  for (const kind of query.kind ?? []) {
    params.append("kind", kind);
  }
  setOptionalParam(params, "include", query.include);
  setOptionalParam(params, "cursor", query.cursor);
  const search = params.toString();

  return search ? `/api/inbox?${search}` : "/api/inbox";
}

function setOptionalParam(
  params: URLSearchParams,
  key: string,
  value: string | undefined,
): void {
  if (value) {
    params.set(key, value);
  }
}
