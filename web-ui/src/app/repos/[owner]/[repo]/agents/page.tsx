export const dynamic = "force-dynamic";
import { query } from '@/lib/db';
import RepoAgentsView, { type RepoAgentRow } from './RepoAgentsView';

export default async function RepoAgents({ params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await params;
  const fullName = `${owner}/${repo}`;

  // Find agents that have pipeline tasks targeting this repo.
  // cost_usd sums pipeline.llm_calls for this agent's tasks; created_by / reason
  // come from those tasks (an agent_id maps 1:1 to a task run in practice).
  const agents = await query<RepoAgentRow>(
    `SELECT t.agent_id,
            count(DISTINCT t.id)::int as task_count,
            COALESCE(SUM(lc.cost_usd), 0)::float as cost_usd,
            string_agg(DISTINCT t.created_by, ', ') as created_by,
            (array_agg(t.task_type ORDER BY t.created_at DESC))[1] as reason_type,
            (array_agg(t.description ORDER BY t.created_at DESC))[1] as reason,
            max(t.created_at) as last_active,
            (SELECT count(*)::int FROM memory.memories m WHERE m.agent_id = t.agent_id AND m.is_deleted = FALSE) as memory_count
     FROM pipeline.tasks t
     LEFT JOIN pipeline.llm_calls lc ON lc.task_id = t.id
     WHERE t.target_repo = $1 AND t.agent_id IS NOT NULL
     GROUP BY t.agent_id
     ORDER BY max(t.created_at) DESC`,
    [fullName]
  );

  return <RepoAgentsView agents={agents} />;
}
