export const dynamic = 'force-dynamic';

import { query, queryOne } from '@/lib/db';
import { resolveDarkFactorySettings, type DarkFactorySettings } from '@/lib/dark-factory-resolve';
import { deriveDarkFactoryConsole, type ConsoleTask, type ConsoleAuditEvent } from './derive-console';
import DarkFactoryConsoleView from './DarkFactoryConsoleView';

const DF_EVENT_TYPES = ['auto_merge_decision', 'escalation_issued', 'lease_expired', 'spec_trace_ingest'];

interface TaskRow {
  id: string;
  task_type: string;
  status: string;
  pr_url: string | null;
  created_at: string | Date;
}

interface AuditRow {
  event_type: string;
  payload: Record<string, unknown> | null;
  created_at: string | Date;
}

const iso = (value: string | Date): string => new Date(value).toISOString();

export default async function DarkFactoryPage({ params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await params;
  const fullName = `${owner}/${repo}`;

  const repoData = await queryOne<{ settings: Record<string, unknown> | null }>(
    `SELECT settings FROM lore.repos WHERE full_name = $1`,
    [fullName],
  );
  if (!repoData) return <div>Repo not found</div>;

  const settings = repoData.settings ?? {};
  const resolved = resolveDarkFactorySettings(settings.dark_factory as DarkFactorySettings | undefined);
  const trustLevel = ((settings.trust as { level?: string } | undefined)?.level) ?? 'unset';

  // Best-effort: pipeline.audit_log may be absent on legacy clusters, and we
  // never want the console to 500 over an empty operational history.
  let tasks: ConsoleTask[] = [];
  let decisions: ConsoleAuditEvent[] = [];
  try {
    const taskRows = await query<TaskRow>(
      `SELECT id, task_type, status, pr_url, created_at FROM pipeline.tasks
        WHERE target_repo = $1 ORDER BY created_at DESC LIMIT 15`,
      [fullName],
    );
    tasks = taskRows.map((row) => ({
      id: String(row.id),
      task_type: row.task_type,
      status: row.status,
      pr_url: row.pr_url,
      created_at: iso(row.created_at),
    }));
  } catch {
    // pipeline.tasks missing — leave tasks empty.
  }
  try {
    const auditRows = await query<AuditRow>(
      `SELECT event_type, payload, created_at FROM pipeline.audit_log
        WHERE repo = $1 AND event_type = ANY($2)
        ORDER BY created_at DESC LIMIT 25`,
      [fullName, DF_EVENT_TYPES],
    );
    decisions = auditRows.map((row) => ({
      event_type: row.event_type,
      payload: row.payload ?? {},
      created_at: iso(row.created_at),
    }));
  } catch {
    // pipeline.audit_log missing — leave decisions empty.
  }

  const model = deriveDarkFactoryConsole({ resolved, trustLevel, tasks, decisions });

  return <DarkFactoryConsoleView owner={owner} repo={repo} model={model} />;
}
