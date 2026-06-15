import { type IngestWorkflowStatus } from '@/lib/ingest-workflow';
import FixIngestButton from '@/components/FixIngestButton';
import Link from 'next/link';
import styles from './HomeView.module.css';

export interface Repo {
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

export interface HomeViewProps {
  repos: Repo[];
  ingestStatus: Map<string, IngestWorkflowStatus>;
  misaligned: string[];
  /** Overview action wired to the Fix-ingest button ("actions up"). */
  fixIngestWorkflows: (repos: string[]) => Promise<{ opened: number; prs: string[] }>;
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

/**
 * Presentational view for the repositories overview. Pure render — the
 * repo list and per-repo ingest-workflow status are resolved by the
 * container (`page.tsx`) and passed down; the only mutation (Fix ingest
 * workflow) is handed in as `fixIngestWorkflows` and fired back up via the
 * client button, keeping this component free of data access.
 */
export default function HomeView({ repos, ingestStatus, misaligned, fixIngestWorkflows }: HomeViewProps) {
  return (
    <div>
      <div className={styles.header}>
        <h1>Repositories</h1>
        <div className={styles.headerActions}>
          <FixIngestButton repos={misaligned} action={fixIngestWorkflows} />
          <Link href="/onboard"><button>+ Add Repo</button></Link>
        </div>
      </div>
      <div className="repo-grid">
        {repos.map(r => (
          <Link key={r.full_name} href={`/repos/${r.owner}/${r.name}`} className="repo-card">
            <h3 className={styles.cardTitle}>
              <span
                title={freshnessIndicator(r.last_ingested_at).label}
                className={styles.freshnessDot}
                style={{ backgroundColor: freshnessIndicator(r.last_ingested_at).color }}
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
                  <span className={`badge ${styles.ingestBadge}`} title={`${badge.label} — fixable from the dashboard`} style={{ backgroundColor: badge.color }}>
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
