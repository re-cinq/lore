import Link from 'next/link';
import ReadmeBox from './ReadmeBox';
import EnrollmentSection from '@/components/EnrollmentSection';
import { type Check } from '@/lib/enrollment';

export interface RepoReadme {
  markdown: string;
  rawBaseUrl: string;
  htmlUrl: string;
}

export interface RecentTask {
  id: string | number;
  description: string;
  status: string;
  agent_id?: string | null;
  pr_url?: string | null;
  created_at: string | Date;
}

export interface RepoOverviewViewProps {
  owner: string;
  repo: string;
  readme: RepoReadme | null;
  enrollmentChecks: Check[];
  darkFactoryEnabled: boolean;
  trustLevel: string;
  darkTasksWeek: number;
  autoMergedWeek: number;
  escalationsWeek: number;
  recentTasks: RecentTask[];
  /** Server action wired to the enrollment re-onboard button ("actions up"). */
  reonboardAction: () => Promise<void>;
}

/**
 * Presentational view for a repo's overview page. Pure render — all data is
 * resolved by the container (`page.tsx`) and passed down; the only mutation
 * (re-onboard) is handed in as `reonboardAction` and fired back up via the
 * EnrollmentSection button, keeping this component free of data access.
 */
export default function RepoOverviewView({
  owner,
  repo,
  readme,
  enrollmentChecks,
  darkFactoryEnabled,
  trustLevel,
  darkTasksWeek,
  autoMergedWeek,
  escalationsWeek,
  recentTasks,
  reonboardAction,
}: RepoOverviewViewProps) {
  return (
    <div>
      {readme && (
        <ReadmeBox markdown={readme.markdown} rawBaseUrl={readme.rawBaseUrl} htmlUrl={readme.htmlUrl} />
      )}

      <EnrollmentSection checks={enrollmentChecks} reonboardAction={reonboardAction} />

      <div className="spec-card" style={{marginBottom:'16px', padding:'16px'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:'8px'}}>
          <h3 style={{margin:0}}>Dark Factory</h3>
          <Link href={`/repos/${owner}/${repo}/settings`} className="meta">configure →</Link>
        </div>
        <div style={{display:'flex',gap:'24px',flexWrap:'wrap'}}>
          <div>
            <div className="meta" style={{fontSize:'var(--fs-xs)',textTransform:'uppercase',letterSpacing:'0.05em'}}>Mode</div>
            <div style={{fontWeight:600,marginTop:'2px'}}>
              {darkFactoryEnabled ? <span style={{color:'var(--success)'}}>Enabled</span> : <span className="meta">Off (legacy)</span>}
            </div>
          </div>
          <div>
            <div className="meta" style={{fontSize:'var(--fs-xs)',textTransform:'uppercase',letterSpacing:'0.05em'}}>Trust</div>
            <div style={{fontWeight:600,marginTop:'2px'}}>{trustLevel}</div>
          </div>
          <div>
            <div className="meta" style={{fontSize:'var(--fs-xs)',textTransform:'uppercase',letterSpacing:'0.05em'}}>Tasks (7d)</div>
            <div style={{fontWeight:600,marginTop:'2px'}}>{darkTasksWeek}</div>
          </div>
          <div>
            <div className="meta" style={{fontSize:'var(--fs-xs)',textTransform:'uppercase',letterSpacing:'0.05em'}}>Auto-merged (7d)</div>
            <div style={{fontWeight:600,marginTop:'2px',color: autoMergedWeek > 0 ? 'var(--success)' : undefined}}>{autoMergedWeek}</div>
          </div>
          <div>
            <div className="meta" style={{fontSize:'var(--fs-xs)',textTransform:'uppercase',letterSpacing:'0.05em'}}>Escalations (7d)</div>
            <div style={{fontWeight:600,marginTop:'2px',color: escalationsWeek > 0 ? 'var(--danger)' : undefined}}>{escalationsWeek}</div>
          </div>
        </div>
      </div>

      <h2>Recent Tasks</h2>
      {recentTasks.length > 0 ? (
        <table>
          <thead><tr><th>Task</th><th>Status</th><th>PR</th><th>Created</th></tr></thead>
          <tbody>
            {recentTasks.map((t) => (
              <tr key={t.id}>
                <td><Link href={`/pipeline/${t.id}`}>{t.description.substring(0, 60)}...</Link></td>
                <td><span className={`op-badge op-${t.status}`}>{t.status}</span></td>
                <td>{t.pr_url ? <a href={t.pr_url} target="_blank">PR</a> : '—'}</td>
                <td className="meta">{new Date(t.created_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="meta">No tasks yet. <Link href={`/repos/${owner}/${repo}/tasks`}>Create one</Link></p>}
    </div>
  );
}
