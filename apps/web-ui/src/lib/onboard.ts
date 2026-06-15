import { query } from './db';

/**
 * Queue an `onboard` pipeline task for a repo. The onboarding agent inspects the
 * repo and generates only the files that are missing, then opens a PR — so this
 * doubles as the "repair my missing scaffolding" path for an already-onboarded
 * repo (e.g. a missing `.github/workflows/lore-ingest.yml`). Returns the task id.
 */
export async function createOnboardTask(fullName: string): Promise<string | null> {
  const task = await query<{ id: string }>(
    `INSERT INTO pipeline.tasks (description, task_type, target_repo, created_by)
     VALUES ($1, 'onboard', $2, 'ui')
     RETURNING id`,
    [fullName, fullName],
  );
  const id = task[0]?.id ?? null;
  if (id) {
    await query(`INSERT INTO pipeline.task_events (task_id, to_status) VALUES ($1, 'pending')`, [id]);
  }
  return id;
}
