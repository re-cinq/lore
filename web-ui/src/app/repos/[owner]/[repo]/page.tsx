export const dynamic = "force-dynamic";
import { query, queryOne, getRepoSchema } from '@/lib/db';
import Link from 'next/link';

export default async function RepoOverview({ params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo: repoName } = await params;
  const fullName = `${owner}/${repoName}`;

  const repoInfo = await queryOne(`SELECT * FROM lore.repos WHERE full_name = $1`, [fullName]);
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
