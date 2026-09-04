export const dynamic = "force-dynamic";

import { getRepo } from "@/lib/api/repos";
import { getRepoTasks, getAuditLog } from "@/lib/api/tasks";
import { resolveDarkFactorySettings } from "@/lib/dark-factory-resolve";
import { deriveDarkFactoryConsole } from "./derive-console";
import {
  unwrapOr,
  normalizeConsoleTasks,
  normalizeConsoleDecisions,
  resolveTrustLevel,
  darkFactorySettingsOf,
  type RawTaskRow,
  type RawAuditRow,
} from "./page-input";
import DarkFactoryConsoleView from "./DarkFactoryConsoleView";

const DF_EVENT_TYPES = [
  "auto_merge_decision",
  "escalation_issued",
  "lease_expired",
  "spec_trace_ingest",
];

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
  const resolved = resolveDarkFactorySettings(darkFactorySettingsOf(settings));
  const trustLevel = resolveTrustLevel(settings);

  // Reads are best-effort; legacy clusters without audit_log return empty list, not failure
  const [taskResult, auditResult] = await Promise.all([
    getRepoTasks(fullName, 15),
    getAuditLog(fullName, DF_EVENT_TYPES),
  ]);
  const tasks = normalizeConsoleTasks(
    unwrapOr(taskResult, { tasks: [] }).tasks as unknown as RawTaskRow[],
  );
  const decisions = normalizeConsoleDecisions(
    unwrapOr(auditResult, { entries: [] }).entries as unknown as RawAuditRow[],
  );

  const model = deriveDarkFactoryConsole({
    resolved,
    trustLevel,
    tasks,
    decisions,
  });

  return <DarkFactoryConsoleView owner={owner} repo={repo} model={model} />;
}
