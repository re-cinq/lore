export const dynamic = "force-dynamic";
import { query } from '@/lib/db';
import { getSession } from '@/lib/session';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

async function createTask(formData: FormData) {
  'use server';
  const description = formData.get('description') as string;
  const taskType = formData.get('task_type') as string || 'general';
  const targetRepo = formData.get('target_repo') as string || 're-cinq/lore';
  const priority = formData.get('priority') as string || 'normal';
  if (!description?.trim()) return;

  const session = await getSession();
  const createdBy = (session?.user?.name || session?.user?.email || 'ui') as string;
  const resolvedPriority = priority === 'immediate' ? 'immediate' : 'normal';

  const result = await query(
    `INSERT INTO pipeline.tasks (description, task_type, target_repo, created_by, priority)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [description, taskType, targetRepo, createdBy, resolvedPriority]
  );
  await query(
    `INSERT INTO pipeline.task_events (task_id, to_status) VALUES ($1, 'pending')`,
    [result[0].id]
  );
  revalidatePath('/pipeline');
  redirect('/pipeline');
}

export default async function CreateTaskPage() {
  // Query onboarded repos from lore.repos for the dropdown
  const onboardedRepos = await query<{ full_name: string }>(
    `SELECT full_name FROM lore.repos ORDER BY full_name`
  );

  return (
    <div>
      <h1>Create Task</h1>
      <form action={createTask} className="task-form">
        <label>Description</label>
        <textarea name="description" rows={4} required placeholder="What should the agent do? Be specific..." />

        <label>Task Type</label>
        <select name="task_type">
          <option value="general">General</option>
          <option value="runbook">Runbook</option>
          <option value="implementation">Implementation</option>
          <option value="gap-fill">Gap Fill</option>
        </select>

        <label>Target Repository</label>
        {onboardedRepos.length > 0 ? (
          <select name="target_repo">
            {onboardedRepos.map((r) => (
              <option key={r.full_name} value={r.full_name}>{r.full_name}</option>
            ))}
          </select>
        ) : (
          <input name="target_repo" defaultValue="re-cinq/lore" placeholder="owner/repo" />
        )}

        <label style={{display:'flex', alignItems:'center', gap:'8px', cursor:'pointer'}}>
          <input type="checkbox" name="priority" value="immediate" />
          <span>Execute immediately</span>
          <span className="meta" style={{fontSize:'12px'}}>— runs on GKE now instead of waiting for local pickup</span>
        </label>

        <button type="submit">Create Task</button>
      </form>
    </div>
  );
}
