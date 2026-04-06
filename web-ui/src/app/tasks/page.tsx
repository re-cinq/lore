export const dynamic = "force-dynamic";

import { query, queryAllChunks } from '@/lib/db';
import { revalidatePath } from 'next/cache';

interface Task {
  id: string;
  content: string;
  content_type: string;
  metadata: Record<string, string>;
  ingested_at: string;
}

interface AuditEntry {
  agent_id: string;
  operation: string;
  memory_key: string;
  metadata: Record<string, string>;
  created_at: string;
}

async function createTask(formData: FormData) {
  'use server';
  const description = formData.get('description') as string;
  if (!description) return;
  await query(
    `INSERT INTO org_shared.chunks (content, content_type, team, repo, file_path, metadata)
     VALUES ($1, 'task', 'org', 're-cinq/lore', 'tasks/ui-created', $2)`,
    [description, JSON.stringify({ created_by: 'ui', status: 'open' })]
  );
  revalidatePath('/tasks');
}

export default async function TasksPage() {
  const allTasks = await queryAllChunks<Task>(
    (schema) => ({
      sql: `SELECT id, content, content_type, metadata, ingested_at
            FROM ${schema}.chunks
            WHERE content_type = 'task'`,
      params: [],
    }),
  );
  const tasks = allTasks.sort((a, b) => new Date(b.ingested_at).getTime() - new Date(a.ingested_at).getTime()).slice(0, 50);

  const recentActivity = await query<AuditEntry>(`
    SELECT agent_id, operation, memory_key, metadata, created_at
    FROM memory.audit_log
    ORDER BY created_at DESC
    LIMIT 15
  `);

  return (
    <div>
      <h1>Tasks</h1>
      <div style={{ background: 'var(--bg-muted, #1a1a2e)', border: '1px solid var(--border)', borderRadius: '6px', padding: '0.75rem 1rem', marginBottom: '1rem' }}>
        <p className="meta" style={{ margin: 0 }}>
          This is the global view across all repos. For repo-specific tasks, visit{' '}
          <a href="/">Repositories</a> and select a repo.
        </p>
      </div>

      <section style={{ marginBottom: '2rem' }}>
        <h2>Create Task</h2>
        <form action={createTask}>
          <textarea
            name="description"
            placeholder="Describe the task for agents..."
            required
            rows={3}
            style={{ width: '100%', marginBottom: '0.5rem' }}
          />
          <button type="submit">Create Task</button>
        </form>
      </section>

      <section style={{ marginBottom: '2rem' }}>
        <h2>Existing Tasks</h2>
        {tasks.length === 0 ? (
          <p className="meta">No tasks found. Create one above.</p>
        ) : (
          tasks.map((task) => {
            const status = task.metadata?.status || 'unknown';
            return (
              <div key={task.id} className="spec-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className={`badge ${status === 'open' ? 'badge-open' : ''}`}>{status}</span>
                  <span className="meta">{new Date(task.ingested_at).toLocaleString()}</span>
                </div>
                <p>{task.content}</p>
              </div>
            );
          })
        )}
      </section>

      <section>
        <h2>Recent Agent Activity</h2>
        {recentActivity.length === 0 ? (
          <p className="meta">No recent agent activity recorded.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '0.5rem', borderBottom: '1px solid var(--border)' }}>Agent</th>
                <th style={{ textAlign: 'left', padding: '0.5rem', borderBottom: '1px solid var(--border)' }}>Operation</th>
                <th style={{ textAlign: 'left', padding: '0.5rem', borderBottom: '1px solid var(--border)' }}>Key</th>
                <th style={{ textAlign: 'left', padding: '0.5rem', borderBottom: '1px solid var(--border)' }}>Time</th>
              </tr>
            </thead>
            <tbody>
              {recentActivity.map((entry, i) => (
                <tr key={i}>
                  <td style={{ padding: '0.5rem', borderBottom: '1px solid var(--border)' }}>{entry.agent_id}</td>
                  <td style={{ padding: '0.5rem', borderBottom: '1px solid var(--border)' }}>
                    <span className="badge">{entry.operation}</span>
                  </td>
                  <td style={{ padding: '0.5rem', borderBottom: '1px solid var(--border)' }}>{entry.memory_key}</td>
                  <td style={{ padding: '0.5rem', borderBottom: '1px solid var(--border)' }} className="meta">
                    {new Date(entry.created_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
