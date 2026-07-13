/**
 * Spec-task parsing with phase-aware dependency inference.
 *
 * Shared between MCP server (webhook sync) and agent (merge-check fallback).
 * DB operations stay in mcp-server/src/tasks.ts.
 */

// ── Types ───────────────────────────────────────────────────────────

export interface ParsedTask {
  specTaskId: string; // e.g. "T001"
  description: string;
  dependsOn: string[]; // e.g. ["T002", "T003"]
  parallelizable: boolean;
  completed: boolean;
  phase: number; // extracted from ## Phase N headers (0 if no phase)
  filePath?: string; // extracted from | file_path suffix
}

// ── Parsing ─────────────────────────────────────────────────────────

// Matches: - [ ] T001 [P] Description | file/path.ts
//      or: - [x] T001 Description [DEPENDS ON: T002, T003]
const TASK_RE = /^- \[([ x])\] (T\d+)\s*/;
const PARALLEL_RE = /\[P\]\s*/;
const DEPENDS_RE = /\[DEPENDS ON:\s*([^\]]+)\]/;
const PHASE_RE = /^##\s+Phase\s+(\d+)/i;
const FILE_PATH_RE = /\|\s*`?([^`\s]+)`?\s*$/;

export function parseTasks(markdown: string): ParsedTask[] {
  const tasks: ParsedTask[] = [];
  let currentPhase = 0;

  for (const line of markdown.split("\n")) {
    const trimmed = line.trim();

    // Check for phase headers
    const phaseMatch = trimmed.match(PHASE_RE);

    if (phaseMatch) {
      currentPhase = parseInt(phaseMatch[1], 10);
      continue;
    }

    const taskMatch = trimmed.match(TASK_RE);

    if (!taskMatch) {
      continue;
    }

    const completed = taskMatch[1] === "x";
    const specTaskId = taskMatch[2];
    let rest = trimmed.slice(taskMatch[0].length);

    // Check for [P] marker
    const parallelizable = PARALLEL_RE.test(rest);

    if (parallelizable) {
      rest = rest.replace(PARALLEL_RE, "");
    }

    // Check for [DEPENDS ON: ...] marker
    const depsMatch = rest.match(DEPENDS_RE);
    const dependsOn: string[] = [];

    if (depsMatch) {
      for (const dep of depsMatch[1].split(",")) {
        const d = dep.trim();

        if (d) {
          dependsOn.push(d);
        }
      }
      rest = rest.replace(DEPENDS_RE, "").trim();
    }

    // Check for | file_path suffix
    let filePath: string | undefined;
    const fileMatch = rest.match(FILE_PATH_RE);

    if (fileMatch) {
      filePath = fileMatch[1];
      rest = rest.replace(FILE_PATH_RE, "").trim();
    }

    tasks.push({
      specTaskId,
      description: rest.trim(),
      dependsOn,
      parallelizable,
      completed,
      phase: currentPhase,
      filePath,
    });
  }

  return tasks;
}

// ── Phase-based dependency inference ────────────────────────────────

/**
 * Infer dependencies from phase structure:
 * - All tasks in Phase N depend on all tasks in Phase N-1 completing
 * - Within a phase, [P] tasks can run in parallel (no intra-phase deps)
 * - Within a phase, non-[P] tasks chain sequentially (each depends on previous)
 * - Explicit [DEPENDS ON:] markers always take precedence (not overwritten)
 */
export function inferPhaseDependencies(tasks: ParsedTask[]): ParsedTask[] {
  if (tasks.length === 0) {
    return tasks;
  }

  // Group tasks by phase
  const phases = new Map<number, ParsedTask[]>();

  for (const task of tasks) {
    const group = phases.get(task.phase) || [];

    group.push(task);
    phases.set(task.phase, group);
  }

  // If all tasks are phase 0 (no phase headers), return unchanged
  const phaseNumbers = [...phases.keys()].sort((a, b) => a - b);

  if (phaseNumbers.length === 1 && phaseNumbers[0] === 0) {
    return tasks;
  }

  // Build the dependency-enriched tasks
  const result: ParsedTask[] = [];

  for (let i = 0; i < phaseNumbers.length; i++) {
    const phaseNum = phaseNumbers[i];
    const phaseTasks = phases.get(phaseNum)!;
    const prevPhaseNum = i > 0 ? phaseNumbers[i - 1] : null;
    const prevPhaseTasks =
      prevPhaseNum !== null ? phases.get(prevPhaseNum)! : [];
    const prevPhaseIds = prevPhaseTasks.map((t) => t.specTaskId);

    // Track last non-parallel task in this phase for sequential chaining
    let lastSequentialId: string | null = null;

    for (const task of phaseTasks) {
      // Skip tasks that already have explicit dependencies
      if (task.dependsOn.length > 0) {
        result.push(task);

        if (!task.parallelizable) {
          lastSequentialId = task.specTaskId;
        }
        continue;
      }

      const inferredDeps: string[] = [];

      // Cross-phase: depend on all tasks from previous phase
      if (prevPhaseIds.length > 0) {
        inferredDeps.push(...prevPhaseIds);
      }

      // Intra-phase: non-[P] tasks chain sequentially
      if (!task.parallelizable && lastSequentialId) {
        if (!inferredDeps.includes(lastSequentialId)) {
          inferredDeps.push(lastSequentialId);
        }
      }

      result.push({
        ...task,
        dependsOn: inferredDeps,
      });

      if (!task.parallelizable) {
        lastSequentialId = task.specTaskId;
      }
    }
  }

  return result;
}

const FEATURE_REQUEST_BRANCH_PREFIX = "lore/feature-request/";

/**
 * Extract the spec slug from a feature-request branch of the form
 * `lore/feature-request/{slug}-{taskId8}`. Returns null when the branch is not a
 * feature-request branch or carries no slug. Single-sources the parse the webhook
 * spec-PR-merge handler and the merge-check fallback both need.
 */
export function specSlugFromBranch(branch: string): string | null {
  if (!branch.startsWith(FEATURE_REQUEST_BRANCH_PREFIX)) {
    return null;
  }
  const slug = branch
    .slice(FEATURE_REQUEST_BRANCH_PREFIX.length)
    .replace(/-[a-f0-9]{8}$/, "");

  return slug || null;
}

/**
 * Upsert parsed spec-tasks into pipeline.tasks (task_type = 'spec-task'). Conflict
 * key is spec_task_id + spec_slug + target_repo. Relocated from mcp-server so the
 * Floor spec-PR-merge event handler and the mcp pipeline tools share one writer.
 */
export async function syncTasksToDb(
  pool: any,
  repo: string,
  specSlug: string,
  tasks: ParsedTask[],
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
    const status = task.completed ? "completed" : "pending";

    const { rows: existing } = await pool.query(
      `SELECT id, status FROM pipeline.tasks
       WHERE target_repo = $1
         AND task_type = 'spec-task'
         AND context_bundle->>'spec_task_id' = $2
         AND context_bundle->>'spec_slug' = $3`,
      [repo, task.specTaskId, specSlug],
    );

    if (existing.length > 0) {
      await pool.query(
        `UPDATE pipeline.tasks
         SET description = $1, context_bundle = $2, status = $3, updated_at = now()
         WHERE id = $4`,
        [title, JSON.stringify(metadata), status, existing[0].id],
      );
    } else {
      if (taskGroupId) {
        await pool.query(
          `INSERT INTO pipeline.tasks (description, task_type, target_repo, status, context_bundle, created_by, task_group_id)
           VALUES ($1, 'spec-task', $2, $3, $4, 'lore_sync_tasks', $5)`,
          [title, repo, status, JSON.stringify(metadata), taskGroupId],
        );
      } else {
        await pool.query(
          `INSERT INTO pipeline.tasks (description, task_type, target_repo, status, context_bundle, created_by)
           VALUES ($1, 'spec-task', $2, $3, $4, 'lore_sync_tasks')`,
          [title, repo, status, JSON.stringify(metadata)],
        );
      }
      created++;
    }
  }

  return { synced: tasks.length, created };
}
