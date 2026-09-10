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

  const model = await consoleModel(fullName, repoData.settings ?? {});

  return <DarkFactoryConsoleView owner={owner} repo={repo} model={model} />;
}

/** The console's whole model. Both reads are BEST-EFFORT: a legacy cluster with no `audit_log` returns an empty list rather than failing, and the activation state above it is worth showing even when the history below is missing. */
async function consoleModel(
  fullName: string,
  settings: Record<string, unknown>,
) {
  const [taskResult, auditResult] = await Promise.all([
    getRepoTasks(fullName, 15),
    getAuditLog(fullName, DF_EVENT_TYPES),
  ]);

  return deriveDarkFactoryConsole({
    resolved: resolveDarkFactorySettings(darkFactorySettingsOf(settings)),
    trustLevel: resolveTrustLevel(settings),
    tasks: normalizeConsoleTasks(
      unwrapOr(taskResult, { tasks: [] }).tasks as unknown as RawTaskRow[],
    ),
    decisions: normalizeConsoleDecisions(
      unwrapOr(auditResult, { entries: [] })
        .entries as unknown as RawAuditRow[],
    ),
  });
}
