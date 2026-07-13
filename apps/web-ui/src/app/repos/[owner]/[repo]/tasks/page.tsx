export const dynamic = "force-dynamic";
import { query } from "@/lib/db";
import RepoTasksView from "./RepoTasksView";
import {
  groupTasksIntoAssemblyLines,
  type AssemblyLineTaskRow,
} from "@/lib/assembly-lines";

export default async function RepoTasks({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}) {
  const { owner, repo } = await params;
  const fullName = `${owner}/${repo}`;

  const tasks = await query<AssemblyLineTaskRow>(
    `SELECT t.id, t.description, t.task_type, t.status, COALESCE(t.priority, 'normal') as priority,
            t.target_repo, t.agent_id, t.pr_url,
            COALESCE(t.pr_number, (t.context_bundle->>'pr_number')::int) as pr_number,
            t.target_branch,
            t.context_bundle->>'parent_task_id' as parent_task_id,
            t.context_bundle->>'retry_of' as retry_of,
            t.created_by, t.created_at, t.updated_at,
            COALESCE(SUM(lc.cost_usd), 0)::float as cost_usd
     FROM pipeline.tasks t
     LEFT JOIN pipeline.llm_calls lc ON lc.task_id = t.id
     WHERE t.target_repo = $1
     GROUP BY t.id
     ORDER BY t.created_at DESC LIMIT 100`,
    [fullName],
  );

  const runs = groupTasksIntoAssemblyLines(tasks);
  return <RepoTasksView owner={owner} repo={repo} runs={runs} />;
}
