/** Spec-task parsing with phase-aware dependency inference (shared MCP/agent); DB ops in mcp-server. */

import type { PgPool } from "./memory-store-types.js";

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

function parseTaskLine(trimmed: string, phase: number): ParsedTask | null {
  const taskMatch = trimmed.match(TASK_RE);

  if (!taskMatch) {
    return null;
  }

  const completed = taskMatch[1] === "x";
  const specTaskId = taskMatch[2];
  const { rest, parallelizable, dependsOn, filePath } = readMarkers(
    trimmed.slice(taskMatch[0].length),
  );

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

/** Parses one trimmed task-list line into a `ParsedTask` for `phase`, or null when the line isn't a task row. */
/** The three optional markers a task line carries — `[P]`, `[DEPENDS ON: …]`, and a trailing `| path` — stripped in that order so what remains is the description alone. Each is removed as it is read: leaving a marker in would put it in the task's own text, where the executor would read it as instructions. */
function readMarkers(afterId: string): {
  rest: string;
  parallelizable: boolean;
  dependsOn: string[];
  filePath: string | undefined;
} {
  const parallelizable = PARALLEL_RE.test(afterId);
  const withoutParallel = parallelizable
    ? afterId.replace(PARALLEL_RE, "")
    : afterId;
  const deps = readDependsOn(withoutParallel);
  const file = readFilePath(deps.rest);

  return {
    rest: file.rest,
    parallelizable,
    dependsOn: deps.dependsOn,
    filePath: file.filePath,
  };
}

/** The `[DEPENDS ON: …]` marker read off and stripped; a line carrying none keeps its text untouched and depends on nothing. */
function readDependsOn(text: string): { rest: string; dependsOn: string[] } {
  const depsMatch = text.match(DEPENDS_RE);

  if (!depsMatch) {
    return { rest: text, dependsOn: [] };
  }
  const deps = depsMatch[1].split(",");
  const dependsOn = deps
    .map((dep) => dep.trim())
    .filter((dep) => dep.length > 0);

  return { rest: text.replace(DEPENDS_RE, "").trim(), dependsOn };
}

/** The trailing `| path` marker read off and stripped; a line carrying none keeps its text untouched and names no file. */
function readFilePath(text: string): {
  rest: string;
  filePath: string | undefined;
} {
  const fileMatch = text.match(FILE_PATH_RE);

  if (!fileMatch) {
    return { rest: text, filePath: undefined };
  }

  return {
    rest: text.replace(FILE_PATH_RE, "").trim(),
    filePath: fileMatch[1],
  };
}

// ── Phase-based dependency inference ────────────────────────────────

/** Infer dependencies from phase structure; [DEPENDS ON:] markers take precedence. */
export function inferPhaseDependencies(tasks: ParsedTask[]): ParsedTask[] {
  if (tasks.length === 0) {
    return tasks;
  }

  const phases = groupTasksByPhase(tasks);
  const phaseNumbers = [...phases.keys()].sort((a, b) => a - b);

  if (!hasPhaseStructure(phaseNumbers)) {
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

/** True when the tasks span headed phases, so there is a structure to infer dependencies from. */
function hasPhaseStructure(phaseNumbers: number[]): boolean {
  return !(phaseNumbers.length === 1 && phaseNumbers[0] === 0);
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

/** The id the next sequential (non-[P]) task in the phase should chain after. */
function nextSequentialId(
  task: ParsedTask,
  current: string | null,
): string | null {
  return task.parallelizable ? current : task.specTaskId;
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
  source: SpecTaskSource,
  tasks: ParsedTask[],
): Promise<{ synced: number; created: number }> {
  let created = 0;

  for (const task of tasks) {
    if (await upsertSpecTask(pool, source, task)) {
      created++;
    }
  }

  return { synced: tasks.length, created };
}

/** Upserts one spec-task, keyed on its spec-task id WITHIN its spec — the ids restart per spec, so the slug is part of the key or two specs' T001 collide. Returns whether a row was created, which is what "N new" in the sync summary counts. */
async function upsertSpecTask(
  pool: PgPool,
  { repo, specSlug, taskGroupId }: SpecTaskSource,
  task: ParsedTask,
): Promise<boolean> {
  const title = `${task.specTaskId}: ${task.description}`;
  const metadata = taskMetadata(task, specSlug);
  const status = task.completed ? "completed" : "pending";
  const row = { title, status, metadata };
  const existingId = await findSpecTask(pool, repo, specSlug, task.specTaskId);

  if (existingId) {
    await updateSpecTask(pool, existingId, row);

    return false;
  }
  await insertSpecTask(pool, { repo, taskGroupId }, row);

  return true;
}

/** What a spec-task carries in its context bundle. `depends_on` and `phase` are stored rather than re-derived: the executor reads them to decide readiness, and re-parsing tasks.md at dispatch would let a since-edited file change what a queued task depends on. */
function taskMetadata(task: ParsedTask, specSlug: string) {
  return {
    spec_task_id: task.specTaskId,
    depends_on: task.dependsOn,
    spec_slug: specSlug,
    parallelizable: task.parallelizable,
    phase: task.phase,
    file_path: task.filePath,
  };
}

/** The existing row for this spec-task, if the sync has run before. */
async function findSpecTask(
  pool: PgPool,
  repo: string,
  specSlug: string,
  specTaskId: string,
): Promise<string | undefined> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id, status FROM pipeline.tasks
       WHERE target_repo = $1
         AND task_type = 'spec-task'
         AND context_bundle->>'spec_task_id' = $2
         AND context_bundle->>'spec_slug' = $3`,
    [repo, specTaskId, specSlug],
  );

  return rows[0]?.id;
}

/** A re-sync refreshes the row in place: a spec-task's identity is its (repo, spec, spec-task id), so an edited tasks.md must not fork a second row. */
async function updateSpecTask(
  pool: PgPool,
  taskId: string,
  row: { title: string; status: string; metadata: object },
): Promise<void> {
  await pool.query(
    `UPDATE pipeline.tasks
         SET description = $1, context_bundle = $2, status = $3, updated_at = now()
         WHERE id = $4`,
    [row.title, JSON.stringify(row.metadata), row.status, taskId],
  );
}

/** Two INSERTs rather than a nullable column: `task_group_id` is what ties a multi-repo feature together, and writing an explicit NULL into it would make an ungrouped task look like a group of one. */
async function insertSpecTask(
  pool: PgPool,
  where: { repo: string; taskGroupId: string | undefined },
  row: { title: string; status: string; metadata: object },
): Promise<void> {
  const sql = where.taskGroupId
    ? `INSERT INTO pipeline.tasks (description, task_type, target_repo, status, context_bundle, created_by, task_group_id)
         VALUES ($1, 'spec-task', $2, $3, $4, 'lore_sync_tasks', $5)`
    : `INSERT INTO pipeline.tasks (description, task_type, target_repo, status, context_bundle, created_by)
         VALUES ($1, 'spec-task', $2, $3, $4, 'lore_sync_tasks')`;

  await pool.query(sql, [
    row.title,
    where.repo,
    row.status,
    JSON.stringify(row.metadata),
    ...(where.taskGroupId ? [where.taskGroupId] : []),
  ]);
}
