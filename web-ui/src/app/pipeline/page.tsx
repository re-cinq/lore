export const dynamic = "force-dynamic";
import { query } from '@/lib/db';
import PipelineListView, { type PipelineTaskRow } from './PipelineListView';

export default async function PipelinePage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;

  const where = status ? 'WHERE t.status = $1' : '';
  const params = status ? [status] : [];
  const tasks = await query<PipelineTaskRow>(
    `SELECT t.id, t.description, t.task_type, t.status, COALESCE(t.priority, 'normal') as priority, t.target_repo, t.agent_id, t.pr_url, t.pr_number, t.created_by, t.created_at
     FROM pipeline.tasks t
     ${where}
     ORDER BY t.created_at DESC LIMIT 50`,
    params
  );

  return <PipelineListView activeStatus={status} tasks={tasks} />;
}
