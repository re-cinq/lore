export const dynamic = "force-dynamic";
import { query } from '@/lib/db';
import Link from 'next/link';

interface Repo {
  full_name: string;
  owner: string;
  name: string;
  team: string | null;
  onboarded_at: string;
  last_ingested_at: string | null;
  onboarding_pr_merged: boolean;
  task_count: number;
  active_agents: number;
}

export default async function HomePage() {
  // Query repos with activity summary
  const repos = await query<Repo>(`
    SELECT r.full_name, r.owner, r.name, r.team, r.onboarded_at,
           r.last_ingested_at, r.onboarding_pr_merged,
           (SELECT count(*)::int FROM pipeline.tasks t WHERE t.target_repo = r.full_name) as task_count,
           (SELECT count(DISTINCT agent_id)::int FROM pipeline.tasks t WHERE t.target_repo = r.full_name AND t.status = 'running') as active_agents
    FROM lore.repos r
    ORDER BY r.onboarded_at DESC
  `);

  return (
    <div>
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
        <h1>Repositories</h1>
        <Link href="/onboard"><button>+ Add Repo</button></Link>
      </div>
      <div className="repo-grid">
        {repos.map(r => (
          <Link key={r.full_name} href={`/repos/${r.owner}/${r.name}`} className="repo-card">
            <h3>{r.full_name}</h3>
            <div className="repo-meta">
              {r.team && <span className="badge">{r.team}</span>}
              <span className="meta">{r.task_count} tasks</span>
              {r.active_agents > 0 && <span className="badge" style={{background:'#1e3a2f',color:'#4ade80'}}>{r.active_agents} running</span>}
            </div>
            <div className="meta">
              {r.last_ingested_at
                ? `Last ingested ${new Date(r.last_ingested_at).toLocaleDateString()}`
                : r.onboarding_pr_merged ? 'Onboarded, awaiting ingestion' : 'Onboarding PR pending'}
            </div>
          </Link>
        ))}
        {repos.length === 0 && (
          <div className="placeholder">
            <p>No repositories onboarded yet.</p>
            <p><Link href="/onboard">Add your first repo</Link> to get started.</p>
          </div>
        )}
      </div>
    </div>
  );
}
