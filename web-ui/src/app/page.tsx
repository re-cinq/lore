export const dynamic = "force-dynamic";
import { query } from '@/lib/db';
import { getRepoFileContent, isGitHubConfigured } from '@/lib/github';
import { LORE_INGEST_WORKFLOW_PATH, ingestWorkflowStatus, type IngestWorkflowStatus } from '@/lib/ingest-workflow';
import { fixIngestWorkflows } from './actions';
import FixIngestButton from '@/components/FixIngestButton';
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
    return { color: 'var(--text-muted)', label: 'Never ingested' };
  }
  const now = new Date();
  const ingested = new Date(lastIngestedAt);
  const hoursAgo = (now.getTime() - ingested.getTime()) / (1000 * 60 * 60);

  if (hoursAgo < 24) {
    return { color: 'var(--success)', label: 'Fresh (< 24h)' };
  } else if (hoursAgo < 7 * 24) {
    return { color: 'var(--warning)', label: 'Stale (< 7d)' };
  } else {
    return { color: 'var(--danger)', label: 'Outdated (> 7d)' };
  }
}

function ingestBadge(status: IngestWorkflowStatus | undefined): { label: string; color: string } | null {
  if (status === 'missing') return { label: 'no ingest workflow', color: 'var(--danger)' };
  if (status === 'stale') return { label: 'ingest workflow outdated', color: 'var(--warning)' };
  return null;
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

  // Per-repo ingest-workflow alignment. Skipped entirely when the GitHub
  // App isn't configured so we never false-flag every repo as missing.
  const ingestStatus = new Map<string, IngestWorkflowStatus>();
  if (isGitHubConfigured()) {
    const statuses = await Promise.all(
      repos.map(r =>
        getRepoFileContent(r.full_name, LORE_INGEST_WORKFLOW_PATH)
          .then(ingestWorkflowStatus)
          .catch(() => 'aligned' as IngestWorkflowStatus),
      ),
    );
    repos.forEach((r, i) => ingestStatus.set(r.full_name, statuses[i]));
  }
  const misaligned = repos
    .filter(r => { const s = ingestStatus.get(r.full_name); return s === 'missing' || s === 'stale'; })
    .map(r => r.full_name);

  return (
    <div>
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
        <h1>Repositories</h1>
        <div style={{display:'flex', gap:'0.5rem', alignItems:'center'}}>
          <FixIngestButton repos={misaligned} action={fixIngestWorkflows} />
          <Link href="/onboard"><button>+ Add Repo</button></Link>
        </div>
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
              {r.active_agents > 0 && <span className="badge badge-green">{r.active_agents} running</span>}
              {(() => {
                const badge = ingestBadge(ingestStatus.get(r.full_name));
                return badge ? (
                  <span className="badge" title={`${badge.label} — fixable from the dashboard`} style={{ backgroundColor: badge.color, color: '#fff' }}>
                    ⚠ {badge.label}
                  </span>
                ) : null;
              })()}
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
