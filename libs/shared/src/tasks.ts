/** Spec-task parsing with phase-aware dependency inference (shared MCP/agent); DB ops in mcp-server. */

import type { PgPool } from "./memory-store.js";

// ── Types ───────────────────────────────────────────────────────────

export interface ParsedTask {
  specTaskId: string; // e.g. "T001"
  description: string;
  dependsOn: string[]; // e.g. ["T002", "T003"]
  parallelizable: boolean;
  completed: boolean;
  phase: number;
  filePath?: string;
}

// ── Parsing ─────────────────────────────────────────────────────────

// Matches: `- [ ] T001 [P] Description | file/path.ts` or `- [x] T001 Description [DEPENDS ON: T002, T003]`
const TASK_RE = /^- \[([ x])\] (T\d+)\s*/;
const PARALLEL_RE = /\[P\]\s*/;
const DEPENDS_RE = /\[DEPENDS ON:\s*([^\]]+)\]/;
const PHASE_RE = /^##\s+Phase\s+(\d+)/i;
const FILE_PATH_RE = /\|\s*`?([^`\s]+)`?\s*$/;

/** Parses one trimmed task-list line into a `ParsedTask` for `phase`, or null when the line isn't a task row. */
function parseTaskLine(trimmed: string, phase: number): ParsedTask | null {
  const taskMatch = trimmed.match(TASK_RE);

  if (!taskMatch) {
    return null;
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
    dependsOn.push(
      ...depsMatch[1]
        .split(",")
        .map((dep) => dep.trim())
        .filter((dep) => dep.length > 0),
    );
    rest = rest.replace(DEPENDS_RE, "").trim();
  }

  // Check for | file_path suffix
  let filePath: string | undefined;
  const fileMatch = rest.match(FILE_PATH_RE);

  if (fileMatch) {
    filePath = fileMatch[1];
    rest = rest.replace(FILE_PATH_RE, "").trim();
  }

  return {
    specTaskId,
    description: rest.trim(),
    dependsOn,
    parallelizable,
    completed,
    phase,
    filePath,
  };
}

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

    const task = parseTaskLine(trimmed, currentPhase);

    if (task) {
      tasks.push(task);
    }
  }

  return tasks;
}

// ── Phase-based dependency inference ────────────────────────────────

/** Groups tasks by their `phase` number, preserving each phase's task order. */
function groupTasksByPhase(tasks: ParsedTask[]): Map<number, ParsedTask[]> {
  const phases = new Map<number, ParsedTask[]>();

  for (const task of tasks) {
    const group = phases.get(task.phase) ?? [];

    group.push(task);
    phases.set(task.phase, group);
  }

  return phases;
}

/** True when every task sits in the (unheaded) default phase, so there's no phase structure to infer from. */
function hasNoPhaseStructure(phaseNumbers: number[]): boolean {
  return phaseNumbers.length === 1 && phaseNumbers[0] === 0;
}

/** Infer dependencies from phase structure; [DEPENDS ON:] markers take precedence. */
export function inferPhaseDependencies(tasks: ParsedTask[]): ParsedTask[] {
  if (tasks.length === 0) {
    return tasks;
  }

  const phases = groupTasksByPhase(tasks);
  const phaseNumbers = [...phases.keys()].sort((a, b) => a - b);

  if (hasNoPhaseStructure(phaseNumbers)) {
    return tasks;
  }

  const result: ParsedTask[] = [];
  let prevPhaseIds: string[] = [];

  for (const phaseNum of phaseNumbers) {
    const phaseTasks = phases.get(phaseNum)!;

    result.push(...enrichPhaseTasks(phaseTasks, prevPhaseIds));
    prevPhaseIds = phaseTasks.map((task) => task.specTaskId);
  }

  return result;
}

/** The id the next sequential (non-[P]) task in the phase should chain after. */
function nextSequentialId(
  task: ParsedTask,
  current: string | null,
): string | null {
  return task.parallelizable ? current : task.specTaskId;
}

/** Cross-phase (all previous-phase ids) + intra-phase (chain onto the last non-[P] task) inferred dependencies for one task. */
function inferDeps(
  task: ParsedTask,
  prevPhaseIds: string[],
  lastSequentialId: string | null,
): string[] {
  const inferredDeps = [...prevPhaseIds];
  const sequentialDep = task.parallelizable ? null : lastSequentialId;

  if (sequentialDep && !inferredDeps.includes(sequentialDep)) {
    inferredDeps.push(sequentialDep);
  }

  return inferredDeps;
}

function enrichPhaseTasks(
  phaseTasks: ParsedTask[],
  prevPhaseIds: string[],
): ParsedTask[] {
  const enriched: ParsedTask[] = [];
  // Track last non-parallel task in this phase for sequential chaining
  let lastSequentialId: string | null = null;

  for (const task of phaseTasks) {
    // Skip tasks that already have explicit dependencies
    const enrichedTask = task.dependsOn.length
      ? task
      : { ...task, dependsOn: inferDeps(task, prevPhaseIds, lastSequentialId) };

    enriched.push(enrichedTask);
    lastSequentialId = nextSequentialId(task, lastSequentialId);
  }

  return enriched;
}

const FEATURE_REQUEST_BRANCH_PREFIX = "lore/feature-request/";

/** Extract spec slug from feature-request branch `lore/feature-request/{slug}-{taskId8}`; single-sourced parser. */
export function specSlugFromBranch(branch: string): string | null {
  if (!branch.startsWith(FEATURE_REQUEST_BRANCH_PREFIX)) {
    return null;
  }
  const slug = branch
    .slice(FEATURE_REQUEST_BRANCH_PREFIX.length)
    .replace(/-[a-f0-9]{8}$/, "");

  return slug || null;
}

/** Upsert spec-tasks to pipeline.tasks (spec-task); conflict key: spec_task_id + spec_slug + target_repo. */
/** The spec whose tasks.md is being synced, and the group its tasks land in. */
export interface SpecTaskSource {
  repo: string;
  specSlug: string;
  taskGroupId?: string;
}

export async function syncTasksToDb(
  pool: PgPool,
  { repo, specSlug, taskGroupId }: SpecTaskSource,
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
      phase: task.phase,
      file_path: task.filePath,
    };
    const status = task.completed ? "completed" : "pending";

    const { rows: existing } = await pool.query<{ id: string; status: string }>(
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
      continue;
    }
    const insertSql = taskGroupId
      ? `INSERT INTO pipeline.tasks (description, task_type, target_repo, status, context_bundle, created_by, task_group_id)
         VALUES ($1, 'spec-task', $2, $3, $4, 'lore_sync_tasks', $5)`
      : `INSERT INTO pipeline.tasks (description, task_type, target_repo, status, context_bundle, created_by)
         VALUES ($1, 'spec-task', $2, $3, $4, 'lore_sync_tasks')`;

    await pool.query(insertSql, [
      title,
      repo,
      status,
      JSON.stringify(metadata),
      ...(taskGroupId ? [taskGroupId] : []),
    ]);
    created++;
  }

  return { synced: tasks.length, created };
}
