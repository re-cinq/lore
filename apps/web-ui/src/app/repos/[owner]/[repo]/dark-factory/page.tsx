export const dynamic = "force-dynamic";

import { getRepo } from "@/lib/api/repos";
import { getRepoTasks, getAuditLog } from "@/lib/api/tasks";
import {
  resolveDarkFactorySettings,
  type DarkFactorySettings,
} from "@/lib/dark-factory-resolve";
import {
  deriveDarkFactoryConsole,
  type ConsoleTask,
  type ConsoleAuditEvent,
} from "./derive-console";
import DarkFactoryConsoleView from "./DarkFactoryConsoleView";
import type { components } from "@/lib/api/schema";

const DF_EVENT_TYPES = [
  "auto_merge_decision",
  "escalation_issued",
  "lease_expired",
  "spec_trace_ingest",
];

interface TaskRow {
  id: string;
  task_type: string;
  status: string;
  pr_url: string | null;
  created_at: string | Date;
}

type AuditRow = components["schemas"]["AuditLogPage"]["entries"][number];

const iso = (value: string | Date): string => new Date(value).toISOString();

export default async function DarkFactoryPage({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}) {
  const { owner, repo } = await params;
  const fullName = `${owner}/${repo}`;

  const repoRecord = await getRepo(fullName);
  const repoData = repoRecord.status === "ok" ? repoRecord.data : null;

  if (!repoData) {
    return <div>Repo not found</div>;
  }

  const settings = repoData.settings ?? {};
  const resolved = resolveDarkFactorySettings(
    settings.dark_factory as DarkFactorySettings | undefined,
  );
  const trustLevel =
    (settings.trust as { level?: string } | undefined)?.level ?? "unset";

  // Both reads are best-effort at the API: a legacy cluster without
  // pipeline.audit_log answers an empty list rather than failing the console.
  const [taskResult, auditResult] = await Promise.all([
    getRepoTasks(fullName, 15),
    getAuditLog(fullName, DF_EVENT_TYPES),
  ]);
  const tasks: ConsoleTask[] = (
    (taskResult.status === "ok"
      ? taskResult.data.tasks
      : []) as unknown as TaskRow[]
  ).map((row) => ({
    id: String(row.id),
    task_type: row.task_type,
    status: row.status,
    pr_url: row.pr_url,
    created_at: iso(row.created_at),
  }));
  const decisions: ConsoleAuditEvent[] = (
    (auditResult.status === "ok"
      ? auditResult.data.entries
      : []) as unknown as AuditRow[]
  ).map((row) => ({
    event_type: row.event_type,
    payload: row.payload ?? {},
    created_at: iso(row.created_at),
  }));

  const model = deriveDarkFactoryConsole({
    resolved,
    trustLevel,
    tasks,
    decisions,
  });

  return <DarkFactoryConsoleView owner={owner} repo={repo} model={model} />;
}
