export const dynamic = "force-dynamic";
import { query } from '@/lib/db';
import AssemblyLineListView from './AssemblyLineListView';
import { groupTasksIntoAssemblyLines, type AssemblyLineTaskRow } from '@/lib/assembly-lines';

export default async function AssemblyLinesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;

  // No SQL status filter: a chain's members carry different statuses, so filtering
  // in SQL would slice members out of an assembly line. Group first, then filter the
  // runs by their rolled-up status. The window is generous so chains stay intact.
  const tasks = await query<AssemblyLineTaskRow>(
    `SELECT t.id, t.description, t.task_type, t.status, COALESCE(t.priority, 'normal') as priority,
            t.target_repo, t.agent_id, t.pr_url,
            COALESCE(t.pr_number, (t.context_bundle->>'pr_number')::int) as pr_number,
            t.target_branch,
            t.context_bundle->>'parent_task_id' as parent_task_id,
            t.context_bundle->>'retry_of' as retry_of,
            t.created_by, t.created_at, t.updated_at
     FROM pipeline.tasks t
     ORDER BY t.created_at DESC LIMIT 100`
  );

  const allRuns = groupTasksIntoAssemblyLines(tasks);
  const runs = status ? allRuns.filter(r => r.status === status) : allRuns;

  return <AssemblyLineListView activeStatus={status} runs={runs} />;
}
