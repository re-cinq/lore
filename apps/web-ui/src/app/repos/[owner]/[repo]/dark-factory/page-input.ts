/** Pure normalizers: turn raw API result shapes into the console deriver's typed input. */

import type { ConsoleTask, ConsoleAuditEvent } from "./derive-console";
import type { DarkFactorySettings } from "@/lib/dark-factory-resolve";

// Untyped endpoints: ConsoleTask/ConsoleAuditEvent's fields, timestamp widened for iso().
export type RawTaskRow = Omit<ConsoleTask, "id" | "created_at"> & {
  id: string | number;
  created_at: string | Date;
};

export type RawAuditRow = Omit<ConsoleAuditEvent, "payload" | "created_at"> & {
  payload?: ConsoleAuditEvent["payload"] | null;
  created_at: string | Date;
};

const iso = (value: string | Date): string => new Date(value).toISOString();

interface ApiResult<T> {
  status: string;
  data?: T;
}

export function unwrapOr<T>(result: ApiResult<T>, fallback: T): T {
  return result.status === "ok" && result.data !== undefined
    ? result.data
    : fallback;
}

export function normalizeConsoleTasks(rows: RawTaskRow[]): ConsoleTask[] {
  return rows.map((row) => ({
    id: String(row.id),
    task_type: row.task_type,
    status: row.status,
    pr_url: row.pr_url,
    created_at: iso(row.created_at),
  }));
}

export function normalizeConsoleDecisions(
  rows: RawAuditRow[],
): ConsoleAuditEvent[] {
  return rows.map((row) => ({
    event_type: row.event_type,
    payload: row.payload ?? {},
    created_at: iso(row.created_at),
  }));
}

interface RepoSettings {
  dark_factory?: unknown;
  trust?: { level?: string };
}

export function resolveTrustLevel(settings: RepoSettings): string {
  return settings.trust?.level ?? "unset";
}

export function darkFactorySettingsOf(
  settings: RepoSettings,
): DarkFactorySettings | undefined {
  return settings.dark_factory as DarkFactorySettings | undefined;
}
