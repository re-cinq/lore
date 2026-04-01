/**
 * Spec-task parsing, syncing, claiming, and completion.
 *
 * Pipeline-backed MCP tools for task tracking.
 * Tasks live in pipeline.tasks with task_type = 'spec-task'.
 */

// ── Types ───────────────────────────────────────────────────────────

export interface ParsedTask {
  specTaskId: string;   // e.g. "T001"
  description: string;
  dependsOn: string[];  // e.g. ["T002", "T003"]
  parallelizable: boolean;
  completed: boolean;
}

// ── Parsing ─────────────────────────────────────────────────────────

// Matches: - [ ] T001 [P] Description [DEPENDS ON: T002, T003]
//      or: - [x] T001 Description
const TASK_RE = /^- \[([ x])\] (T\d+)\s*/;
const PARALLEL_RE = /\[P\]\s*/;
const DEPENDS_RE = /\[DEPENDS ON:\s*([^\]]+)\]/;

export function parseTasks(markdown: string): ParsedTask[] {
  const tasks: ParsedTask[] = [];

  for (const line of markdown.split('\n')) {
    const trimmed = line.trim();
    const taskMatch = trimmed.match(TASK_RE);
    if (!taskMatch) continue;

    const completed = taskMatch[1] === 'x';
    const specTaskId = taskMatch[2];
    let rest = trimmed.slice(taskMatch[0].length);

    // Check for [P] marker
    const parallelizable = PARALLEL_RE.test(rest);
    if (parallelizable) {
      rest = rest.replace(PARALLEL_RE, '');
    }

    // Check for [DEPENDS ON: ...] marker
    const depsMatch = rest.match(DEPENDS_RE);
    const dependsOn: string[] = [];
    if (depsMatch) {
      for (const dep of depsMatch[1].split(',')) {
        const d = dep.trim();
        if (d) dependsOn.push(d);
      }
      rest = rest.replace(DEPENDS_RE, '').trim();
    }

    tasks.push({
      specTaskId,
      description: rest.trim(),
      dependsOn,
      parallelizable,
      completed,
    });
  }

  return tasks;
}

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
  tasks: ParsedTask[],
): Promise<{ synced: number; created: number }> {
  let created = 0;

  for (const task of tasks) {
    const title = `${task.specTaskId}: ${task.description}`;
    const metadata = {
      spec_task_id: task.specTaskId,
      depends_on: task.dependsOn,
      spec_slug: specSlug,
      parallelizable: task.parallelizable,
    };
    const status = task.completed ? 'completed' : 'pending';

    // Check if a task with this spec_task_id + spec_slug + repo already exists
    const { rows: existing } = await pool.query(
      `SELECT id, status FROM pipeline.tasks
       WHERE target_repo = $1
         AND task_type = 'spec-task'
         AND metadata->>'spec_task_id' = $2
         AND metadata->>'spec_slug' = $3`,
      [repo, task.specTaskId, specSlug],
    );

    if (existing.length > 0) {
      // Update existing task
      await pool.query(
        `UPDATE pipeline.tasks
         SET description = $1, metadata = $2, status = $3, updated_at = now()
         WHERE id = $4`,
        [title, JSON.stringify(metadata), status, existing[0].id],
      );
    } else {
      // Insert new task
      await pool.query(
        `INSERT INTO pipeline.tasks (description, task_type, target_repo, status, metadata, created_by)
         VALUES ($1, 'spec-task', $2, $3, $4, 'sync_tasks')`,
        [title, repo, status, JSON.stringify(metadata)],
      );
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
    `SELECT t.id, t.description, t.status, t.metadata, t.agent_id
     FROM pipeline.tasks t
     WHERE t.task_type = 'spec-task'
       AND t.target_repo = $1
       AND t.status = 'pending'
       AND NOT EXISTS (
         SELECT 1
         FROM jsonb_array_elements_text(t.metadata->'depends_on') AS dep_id
         WHERE NOT EXISTS (
           SELECT 1 FROM pipeline.tasks d
           WHERE d.target_repo = $1
             AND d.task_type = 'spec-task'
             AND d.metadata->>'spec_task_id' = dep_id
             AND d.metadata->>'spec_slug' = t.metadata->>'spec_slug'
             AND d.status IN ('completed', 'merged')
         )
       )
     ORDER BY t.metadata->>'spec_task_id'`,
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
    `SELECT id, status, metadata, target_repo FROM pipeline.tasks WHERE id = $1`,
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
  const specTaskId = task.metadata?.spec_task_id;
  const specSlug = task.metadata?.spec_slug;
  if (!specTaskId || !specSlug) {
    return { completed: true, unblocked: [] };
  }

  // Get tasks that list this task in their depends_on
  const { rows: dependents } = await pool.query(
    `SELECT t.id, t.description, t.metadata
     FROM pipeline.tasks t
     WHERE t.task_type = 'spec-task'
       AND t.target_repo = $1
       AND t.metadata->>'spec_slug' = $2
       AND t.status = 'pending'
       AND t.metadata->'depends_on' ? $3
       AND NOT EXISTS (
         SELECT 1
         FROM jsonb_array_elements_text(t.metadata->'depends_on') AS dep_id
         WHERE NOT EXISTS (
           SELECT 1 FROM pipeline.tasks d
           WHERE d.target_repo = $1
             AND d.task_type = 'spec-task'
             AND d.metadata->>'spec_task_id' = dep_id
             AND d.metadata->>'spec_slug' = $2
             AND d.status IN ('completed', 'merged')
         )
       )`,
    [task.target_repo, specSlug, specTaskId],
  );

  const unblocked = dependents.map((d: any) => `${d.metadata?.spec_task_id}: ${d.description}`);
  return { completed: true, unblocked };
}
