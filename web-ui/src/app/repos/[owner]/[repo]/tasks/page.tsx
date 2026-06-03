export const dynamic = "force-dynamic";
import { query } from '@/lib/db';
import RepoTasksView, { type RepoTaskRow } from './RepoTasksView';

export default async function RepoTasks({ params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await params;
  const fullName = `${owner}/${repo}`;

  const tasks = await query<RepoTaskRow>(
    `SELECT t.id, t.description, t.task_type, t.status, t.agent_id, t.pr_url, t.created_at, t.created_by,
            COALESCE(SUM(lc.cost_usd), 0)::float as cost_usd
     FROM pipeline.tasks t
     LEFT JOIN pipeline.llm_calls lc ON lc.task_id = t.id
     WHERE t.target_repo = $1
     GROUP BY t.id
     ORDER BY t.created_at DESC LIMIT 50`,
    [fullName]
  );

  return <RepoTasksView owner={owner} repo={repo} tasks={tasks} />;
}
