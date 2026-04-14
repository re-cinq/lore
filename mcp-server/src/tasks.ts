/**
 * Spec-task syncing, claiming, and completion.
 *
 * Pipeline-backed MCP tools for task tracking.
 * Tasks live in pipeline.tasks with task_type = 'spec-task'.
 *
 * Parsing logic lives in @re-cinq/lore-shared so the agent can reuse it.
 */

// Re-export parsing from shared package
export { parseTasks, inferPhaseDependencies, type ParsedTask } from '@re-cinq/lore-shared';

// ── DB operations ───────────────────────────────────────────────────

/**
 * Upsert parsed tasks into pipeline.tasks.
 * Uses metadata->>spec_task_id + target_repo + metadata->>spec_slug
 * as the conflict key (via a conditional insert/update).
 */
export async function syncTasksToDb(
  pool: any,
  repo: string,
  specSlug: string,
  tasks: import('@re-cinq/lore-shared').ParsedTask[],
  taskGroupId?: string,
): Promise<{ synced: number; created: number }> {
  let created = 0;

  for (const task of tasks) {
    const title = `${task.specTaskId}: ${task.description}`;
    const metadata = {
      spec_task_id: task.specTaskId,
      depends_on: task.dependsOn,
      spec_slug: specSlug,
      parallelizable: task.parallelizable,
      phase: task.phase,
      file_path: task.filePath,
    };
    const status = task.completed ? 'completed' : 'pending';

    // Check if a task with this spec_task_id + spec_slug + repo already exists
    const { rows: existing } = await pool.query(
      `SELECT id, status FROM pipeline.tasks
       WHERE target_repo = $1
         AND task_type = 'spec-task'
         AND context_bundle->>'spec_task_id' = $2
         AND context_bundle->>'spec_slug' = $3`,
      [repo, task.specTaskId, specSlug],
    );

    if (existing.length > 0) {
      // Update existing task
      await pool.query(
        `UPDATE pipeline.tasks
         SET description = $1, context_bundle = $2, status = $3, updated_at = now()
         WHERE id = $4`,
        [title, JSON.stringify(metadata), status, existing[0].id],
      );
    } else {
      // Insert new task
      if (taskGroupId) {
        await pool.query(
          `INSERT INTO pipeline.tasks (description, task_type, target_repo, status, context_bundle, created_by, task_group_id)
           VALUES ($1, 'spec-task', $2, $3, $4, 'sync_tasks', $5)`,
          [title, repo, status, JSON.stringify(metadata), taskGroupId],
        );
      } else {
        await pool.query(
          `INSERT INTO pipeline.tasks (description, task_type, target_repo, status, context_bundle, created_by)
           VALUES ($1, 'spec-task', $2, $3, $4, 'sync_tasks')`,
          [title, repo, status, JSON.stringify(metadata)],
        );
      }
      created++;
    }
  }

  return { synced: tasks.length, created };
}

/**
 * Return tasks where all dependencies are satisfied
 * (i.e. every task in metadata->'depends_on' has status IN ('completed', 'merged')).
 */
export async function getReadyTasks(pool: any, repo: string): Promise<any[]> {
  const { rows } = await pool.query(
    `SELECT t.id, t.description, t.status, t.context_bundle, t.agent_id
     FROM pipeline.tasks t
     WHERE t.task_type = 'spec-task'
       AND t.target_repo = $1
       AND t.status = 'pending'
       AND NOT EXISTS (
         SELECT 1
         FROM jsonb_array_elements_text(t.context_bundle->'depends_on') AS dep_id
         WHERE NOT EXISTS (
           SELECT 1 FROM pipeline.tasks d
           WHERE d.target_repo = $1
             AND d.task_type = 'spec-task'
             AND d.context_bundle->>'spec_task_id' = dep_id
             AND d.context_bundle->>'spec_slug' = t.context_bundle->>'spec_slug'
             AND d.status IN ('completed', 'merged')
         )
       )
     ORDER BY t.context_bundle->>'spec_task_id'`,
    [repo],
  );
  return rows;
}

/**
 * Atomically claim a task using SELECT ... FOR UPDATE SKIP LOCKED.
 * Returns true if claimed, false if already taken or not found.
 */
export async function claimTask(
  pool: any,
  taskId: string,
  agentId: string,
): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT id FROM pipeline.tasks
       WHERE id = $1 AND status = 'pending'
       FOR UPDATE SKIP LOCKED`,
      [taskId],
    );

    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return false;
    }

    await client.query(
      `UPDATE pipeline.tasks SET status = 'running', agent_id = $2, updated_at = now() WHERE id = $1`,
      [taskId, agentId],
    );

    // Record event
    try {
      await client.query(
        `INSERT INTO pipeline.task_events (task_id, from_status, to_status, metadata)
         VALUES ($1, 'pending', 'running', $2)`,
        [taskId, JSON.stringify({ agent_id: agentId, claimed_by: 'claim_task' })],
      );
    } catch { /* event recording must not block */ }

    await client.query('COMMIT');
    return true;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Mark a task as completed and return any newly unblocked dependents.
 */
export async function completeTask(
  pool: any,
  taskId: string,
): Promise<{ completed: boolean; unblocked: string[] }> {
  // Get the task to find its spec_task_id and spec_slug
  const { rows: taskRows } = await pool.query(
    `SELECT id, status, context_bundle, target_repo FROM pipeline.tasks WHERE id = $1`,
    [taskId],
  );

  if (taskRows.length === 0) {
    return { completed: false, unblocked: [] };
  }

  const task = taskRows[0];
  if (task.status !== 'running') {
    return { completed: false, unblocked: [] };
  }

  // Mark as completed
  await pool.query(
    `UPDATE pipeline.tasks SET status = 'completed', updated_at = now() WHERE id = $1`,
    [taskId],
  );

  // Record event
  try {
    await pool.query(
      `INSERT INTO pipeline.task_events (task_id, from_status, to_status, metadata)
       VALUES ($1, 'running', 'completed', '{}')`,
      [taskId],
    );
  } catch { /* event recording must not block */ }

  // Find newly unblocked tasks: tasks that depend on this one
  // and now have all dependencies satisfied
  const specTaskId = task.context_bundle?.spec_task_id;
  const specSlug = task.context_bundle?.spec_slug;
  if (!specTaskId || !specSlug) {
    return { completed: true, unblocked: [] };
  }

  // Get tasks that list this task in their depends_on
  const { rows: dependents } = await pool.query(
    `SELECT t.id, t.description, t.context_bundle
     FROM pipeline.tasks t
     WHERE t.task_type = 'spec-task'
       AND t.target_repo = $1
       AND t.context_bundle->>'spec_slug' = $2
       AND t.status = 'pending'
       AND t.context_bundle->'depends_on' ? $3
       AND NOT EXISTS (
         SELECT 1
         FROM jsonb_array_elements_text(t.context_bundle->'depends_on') AS dep_id
         WHERE NOT EXISTS (
           SELECT 1 FROM pipeline.tasks d
           WHERE d.target_repo = $1
             AND d.task_type = 'spec-task'
             AND d.context_bundle->>'spec_task_id' = dep_id
             AND d.context_bundle->>'spec_slug' = $2
             AND d.status IN ('completed', 'merged')
         )
       )`,
    [task.target_repo, specSlug, specTaskId],
  );

  const unblocked = dependents.map((d: any) => `${d.context_bundle?.spec_task_id}: ${d.description}`);
  return { completed: true, unblocked };
}
