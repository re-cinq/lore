export const dynamic = "force-dynamic";
import { query } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

async function createTask(formData: FormData) {
  'use server';
  const description = formData.get('description') as string;
  const taskType = formData.get('task_type') as string || 'general';
  const targetRepo = formData.get('target_repo') as string || 're-cinq/lore';
  if (!description?.trim()) return;

  const result = await query(
    `INSERT INTO pipeline.tasks (description, task_type, target_repo, created_by)
     VALUES ($1, $2, $3, 'ui') RETURNING id`,
    [description, taskType, targetRepo]
  );
  await query(
    `INSERT INTO pipeline.task_events (task_id, to_status) VALUES ($1, 'pending')`,
    [result[0].id]
  );
  revalidatePath('/pipeline');
  redirect('/pipeline');
}

export default function CreateTaskPage() {
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
        <input name="target_repo" defaultValue="re-cinq/lore" placeholder="owner/repo" />

        <button type="submit">Create Task</button>
      </form>
    </div>
  );
}
