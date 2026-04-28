export const dynamic = "force-dynamic";
import { query, queryOne, getRepoSchema } from '@/lib/db';
import Link from 'next/link';

export default async function RepoOverview({ params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo: repoName } = await params;
  const fullName = `${owner}/${repoName}`;

  const repoInfo = await queryOne<{
    settings?: { dark_factory?: { enabled?: boolean }; trust?: { level?: string } };
    onboarded_at: string;
    last_ingested_at?: string;
    team?: string;
  }>(`SELECT * FROM lore.repos WHERE full_name = $1`, [fullName]);
  const recentTasks = await query(
    `SELECT id, description, status, agent_id, pr_url, created_at
     FROM pipeline.tasks WHERE target_repo = $1 ORDER BY created_at DESC LIMIT 5`,
    [fullName]
  );
  const schema = await getRepoSchema(fullName);
  const contextCount = await queryOne<{count: number}>(
    `SELECT count(*)::int as count FROM ${schema}.chunks WHERE repo = $1`,
    [fullName]
  );

  // Dark Factory dashboard counts (T052) — best-effort, falls back to
  // zero on any DB error so the panel never breaks the page.
  const darkFactoryEnabled = repoInfo?.settings?.dark_factory?.enabled === true;
  const trustLevel = repoInfo?.settings?.trust?.level ?? "unset";
  let darkTasksWeek = 0;
  let autoMergedWeek = 0;
  let escalationsWeek = 0;
  try {
    const dt = await queryOne<{ c: number }>(
      `SELECT count(*)::int as c FROM pipeline.tasks
        WHERE target_repo = $1 AND created_at >= now() - interval '7 days'`,
      [fullName],
    );
    darkTasksWeek = dt?.c ?? 0;
    const am = await queryOne<{ c: number }>(
      `SELECT count(*)::int as c FROM pipeline.audit_log
        WHERE repo = $1
          AND event_type = 'auto_merge_decision'
          AND payload->>'outcome' = 'merged'
          AND created_at >= now() - interval '7 days'`,
      [fullName],
    );
    autoMergedWeek = am?.c ?? 0;
    const es = await queryOne<{ c: number }>(
      `SELECT count(*)::int as c FROM pipeline.audit_log
        WHERE repo = $1
          AND event_type = 'escalation_issued'
          AND created_at >= now() - interval '7 days'`,
      [fullName],
    );
    escalationsWeek = es?.c ?? 0;
  } catch {
    // pipeline.audit_log may not exist yet on legacy clusters.
  }

  return (
    <div>
      {repoInfo && (
        <div className="spec-card" style={{marginBottom:'16px'}}>
          {repoInfo.team && <span className="badge">{repoInfo.team}</span>}
          <span className="meta" style={{marginLeft:'8px'}}>
            Onboarded {new Date(repoInfo.onboarded_at).toLocaleDateString()}
          </span>
          {repoInfo.last_ingested_at && (
            <span className="meta" style={{marginLeft:'8px'}}>
              Last ingested {new Date(repoInfo.last_ingested_at).toLocaleDateString()}
            </span>
          )}
          <span className="meta" style={{marginLeft:'8px'}}>
            {contextCount?.count || 0} context chunks
          </span>
        </div>
      )}

      <div className="spec-card" style={{marginBottom:'16px', padding:'16px'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:'8px'}}>
          <h3 style={{margin:0}}>Dark Factory</h3>
          <Link href={`/repos/${owner}/${repoName}/settings`} className="meta">configure →</Link>
        </div>
        <div style={{display:'flex',gap:'24px',flexWrap:'wrap'}}>
          <div>
            <div className="meta" style={{fontSize:'11px',textTransform:'uppercase',letterSpacing:'0.05em'}}>Mode</div>
            <div style={{fontWeight:600,marginTop:'2px'}}>
              {darkFactoryEnabled ? <span style={{color:'#3fb950'}}>Enabled</span> : <span className="meta">Off (legacy)</span>}
            </div>
          </div>
          <div>
            <div className="meta" style={{fontSize:'11px',textTransform:'uppercase',letterSpacing:'0.05em'}}>Trust</div>
            <div style={{fontWeight:600,marginTop:'2px'}}>{trustLevel}</div>
          </div>
          <div>
            <div className="meta" style={{fontSize:'11px',textTransform:'uppercase',letterSpacing:'0.05em'}}>Tasks (7d)</div>
            <div style={{fontWeight:600,marginTop:'2px'}}>{darkTasksWeek}</div>
          </div>
          <div>
            <div className="meta" style={{fontSize:'11px',textTransform:'uppercase',letterSpacing:'0.05em'}}>Auto-merged (7d)</div>
            <div style={{fontWeight:600,marginTop:'2px',color: autoMergedWeek > 0 ? '#3fb950' : undefined}}>{autoMergedWeek}</div>
          </div>
          <div>
            <div className="meta" style={{fontSize:'11px',textTransform:'uppercase',letterSpacing:'0.05em'}}>Escalations (7d)</div>
            <div style={{fontWeight:600,marginTop:'2px',color: escalationsWeek > 0 ? '#f85149' : undefined}}>{escalationsWeek}</div>
          </div>
        </div>
      </div>

      <h2>Recent Tasks</h2>
      {recentTasks.length > 0 ? (
        <table>
          <thead><tr><th>Task</th><th>Status</th><th>PR</th><th>Created</th></tr></thead>
          <tbody>
            {recentTasks.map((t: any) => (
              <tr key={t.id}>
                <td><Link href={`/pipeline/${t.id}`}>{t.description.substring(0, 60)}...</Link></td>
                <td><span className={`op-badge op-${t.status}`}>{t.status}</span></td>
                <td>{t.pr_url ? <a href={t.pr_url} target="_blank">PR</a> : '—'}</td>
                <td className="meta">{new Date(t.created_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="meta">No tasks yet. <Link href={`/repos/${owner}/${repoName}/tasks`}>Create one</Link></p>}
    </div>
  );
}
