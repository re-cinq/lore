export const dynamic = "force-dynamic";
import { query } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

async function createTask(formData: FormData) {
  'use server';
  const description = formData.get('description') as string;
  const taskType = formData.get('task_type') as string || 'general';
  const targetRepo = formData.get('target_repo') as string;
  const priority = formData.get('priority') as string || 'normal';
  if (!description?.trim()) return;

  const resolvedPriority = priority === 'immediate' ? 'immediate' : 'normal';
  await query(
    `INSERT INTO pipeline.tasks (description, task_type, target_repo, created_by, priority)
     VALUES ($1, $2, $3, 'ui', $4)`,
    [description, taskType, targetRepo, resolvedPriority]
  );
  // Also insert the initial event
  const task = await query(`SELECT id FROM pipeline.tasks ORDER BY created_at DESC LIMIT 1`);
  if (task[0]) {
    await query(`INSERT INTO pipeline.task_events (task_id, to_status) VALUES ($1, 'pending')`, [task[0].id]);
  }
  revalidatePath(`/repos/${targetRepo}/tasks`);
  redirect(`/repos/${targetRepo.split('/')[0]}/${targetRepo.split('/')[1]}/tasks`);
}

export default async function CreateRepoTask({ params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await params;
  const fullName = `${owner}/${repo}`;

  return (
    <div>
      <h2>New Task for {fullName}</h2>
      <form action={createTask} className="task-form" style={{maxWidth:'600px'}}>
        <input type="hidden" name="target_repo" value={fullName} />

        <label>Task Type</label>
        <select name="task_type" id="task_type">
          <option value="feature-request">Feature Request (PM intent → spec)</option>
          <option value="general">General</option>
          <option value="runbook">Runbook</option>
          <option value="implementation">Implementation</option>
          <option value="gap-fill">Gap Fill</option>
        </select>

        <label>Description</label>
        <textarea name="description" rows={5} required placeholder="Describe what you want built. Plain language is fine — the agent will translate it into a proper spec following this repo's conventions." />

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
