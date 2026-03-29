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

function freshnessIndicator(lastIngestedAt: string | null): { color: string; label: string } {
  if (!lastIngestedAt) {
    return { color: '#6b7280', label: 'Never ingested' }; // gray
  }
  const now = new Date();
  const ingested = new Date(lastIngestedAt);
  const hoursAgo = (now.getTime() - ingested.getTime()) / (1000 * 60 * 60);

  if (hoursAgo < 24) {
    return { color: '#22c55e', label: 'Fresh (< 24h)' }; // green
  } else if (hoursAgo < 7 * 24) {
    return { color: '#eab308', label: 'Stale (< 7d)' }; // yellow
  } else {
    return { color: '#ef4444', label: 'Outdated (> 7d)' }; // red
  }
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
            <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span
                title={freshnessIndicator(r.last_ingested_at).label}
                style={{
                  display: 'inline-block',
                  width: '10px',
                  height: '10px',
                  borderRadius: '50%',
                  backgroundColor: freshnessIndicator(r.last_ingested_at).color,
                  flexShrink: 0,
                }}
              />
              {r.full_name}
            </h3>
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
