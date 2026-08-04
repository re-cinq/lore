import { randomUUID } from "node:crypto";
import { enforceTrue } from "../../lib/enforce.js";
import type { PipelineTask } from "../../types.js";
import {
  ALLOWED_TASK_COLUMNS,
  enforceTrustAllowsTaskType,
  type CreateTaskInput,
  type CreatedTask,
  type RetriedTask,
} from "../../pipeline-tasks.js";
import {
  PENDING_STATUSES,
  RUNNING_STATUSES,
  EXECUTED_STATUSES,
  NEXT_STATUS,
  type TaskStorePort,
  type TaskAction,
  type TaskTransitionMeta,
  type TaskWithEvents,
  type TaskListResult,
  type FindOpenLikeInput,
  type DriftTaskRow,
} from "./task-store-port.js";

/**
 * Seed row for {@link InMemoryTaskStore}. A loose superset of the
 * `pipeline.tasks` columns the store reads — tests set only what they exercise.
 */
export interface SeedStoreTask {
  id: string;
  description?: string;
  task_type?: string;
  status?: string;
  target_repo?: string | null;
  priority?: string;
  created_by?: string;
  created_at?: string;
  updated_at?: string;
  claimed_by?: string | null;
  context_bundle?: Record<string, unknown> | null;
  context_refs?: { fact_ids: string[]; memory_ids: string[] } | null;
  issue_number?: number | null;
  [key: string]: unknown;
}

/** A `pipeline.task_events` row as the double records it. */
export interface StoredTaskEvent {
  task_id: string;
  from_status: string | null;
  to_status: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

/** Per-repo `lore.repos.settings` seed for the create trust gate. */
export type SeedRepoSettings = Record<string, { trust?: { level?: string } }>;

/**
 * Translate a SQL LIKE pattern to a RegExp — including the quirk that the Pg
 * adapter does NOT escape `%`/`_` in the caller's prefix, so those act as
 * wildcards there too.
 */
function likeToRegExp(pattern: string): RegExp {
  const source = pattern
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/%/g, ".*")
    .replace(/_/g, ".");

  return new RegExp(`^${source}$`);
}

/**
 * In-memory {@link TaskStorePort}: the behavioral spec of the Pg adapter — the
 * four inline queries plus the delegated pipeline-tasks.ts CRUD (create/retry/
 * status/event mechanics), computed over seeded rows. JSONB values are stored
 * in their parsed form (node-pg returns jsonb parsed, so through the Pg adapter
 * callers only ever see the parsed value). `now` is injectable so created_at
 * ordering is deterministic in tests.
 */
export class InMemoryTaskStore implements TaskStorePort {
  readonly events: StoredTaskEvent[] = [];
  private readonly repoSettings: SeedRepoSettings;
  private readonly now: () => Date;

  constructor(
    public tasks: SeedStoreTask[] = [],
    opts: { repoSettings?: SeedRepoSettings; now?: () => Date } = {},
  ) {
    this.repoSettings = opts.repoSettings ?? {};
    this.now = opts.now ?? (() => new Date());
  }

  async pending(repo: string): Promise<PipelineTask[]> {
    return this.byStatus(repo, PENDING_STATUSES);
  }

  async running(repo: string): Promise<PipelineTask[]> {
    return this.byStatus(repo, RUNNING_STATUSES);
  }

  async executed(repo: string): Promise<PipelineTask[]> {
    return this.byStatus(repo, EXECUTED_STATUSES);
  }

  async getById(id: string): Promise<PipelineTask | null> {
    return (this.findById(id) as PipelineTask | undefined) ?? null;
  }

  async create(input: CreateTaskInput): Promise<CreatedTask> {
    const taskType = input.taskType ?? "general";
    const repo = input.targetRepo;
    const createdBy = input.createdBy ?? "ui";

    enforceTrue(
      input.description.length <= 10000,
      Error,
      "Description too long (max 10000 chars)",
    );

    // The gate only fires for a seeded repo row — mirrors the Pg read of
    // lore.repos, where an absent row (or a read error) skips the check.
    if (repo && this.repoSettings[repo]) {
      enforceTrustAllowsTaskType(
        this.repoSettings[repo].trust?.level,
        taskType,
        repo,
      );
    }
    const priority = input.priority === "immediate" ? "immediate" : "normal";
    const createdAt = this.now().toISOString();
    const task: SeedStoreTask = {
      id: randomUUID(),
      description: input.description,
      task_type: taskType,
      target_repo: repo ?? null,
      // `status` comes from the pipeline.tasks column default.
      status: "pending",
      created_by: createdBy,
      context_bundle: input.contextBundle ?? null,
      priority,
      created_at: createdAt,
      updated_at: createdAt,
    };

    if (input.taskGroupId) {
      task.task_group_id = input.taskGroupId;
    }
    this.tasks.push(task);

    if (
      input.contextRefs &&
      (input.contextRefs.fact_ids.length > 0 ||
        input.contextRefs.memory_ids.length > 0)
    ) {
      task.context_refs = input.contextRefs;
    }
    await this.recordEvent(task.id, null, "pending", {
      created_by: createdBy,
      priority,
    });

    return {
      task_id: task.id,
      task_type: taskType,
      status: "pending",
      priority,
      created_at: createdAt,
    };
  }

  async retry(id: string): Promise<RetriedTask> {
    const task = this.findById(id);

    enforceTrue(task, Error, "Task not found");
    enforceTrue(
      !(task.status !== "failed" && task.status !== "needs-human-help"),
      Error,
      `Cannot retry task in ${task.status} state (must be failed or needs-human-help)`,
    );
    const result = await this.create({
      description: task.description ?? "",
      taskType: task.task_type,
      targetRepo: task.target_repo ?? undefined,
      createdBy: `retry:${task.created_by}`,
      contextBundle: { ...(task.context_bundle || {}), retry_of: id },
    });

    await this.updateStatus(id, "retried", { retried_as: result.task_id });

    return { task_id: result.task_id, status: result.status, retry_of: id };
  }

  async list(status?: string, limit = 50): Promise<TaskListResult> {
    const matching = this.tasks
      .filter((t) => !status || t.status === status)
      .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));

    return {
      tasks: matching.slice(0, limit) as unknown as PipelineTask[],
      total: matching.length,
    };
  }

  async getWithEvents(id: string): Promise<TaskWithEvents | null> {
    const task = this.findById(id);

    if (!task) {
      return null;
    }
    const events = this.events
      .filter((e) => e.task_id === id)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));

    return { ...(task as unknown as PipelineTask), events };
  }

  async setStatus(
    id: string,
    status: string,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    const task = this.findById(id);

    if (!task) {
      return;
    }
    task.status = status;
    task.updated_at = this.now().toISOString();

    for (const [key, value] of Object.entries(extra)) {
      // Same silent-skip gate as setTaskStatus (unlike setColumns, no throw).
      if (ALLOWED_TASK_COLUMNS.has(key)) {
        task[key] = value;
      }
    }
  }

  async setStatusIf(
    id: string,
    expectedStatus: string,
    status: string,
    extra: Record<string, unknown> = {},
  ): Promise<boolean> {
    const task = this.findById(id);

    if (!task || task.status !== expectedStatus) {
      return false;
    }
    await this.setStatus(id, status, extra);

    return true;
  }

  async updateStatus(
    id: string,
    status: string,
    meta?: Record<string, unknown>,
  ): Promise<void> {
    const task = this.findById(id);

    if (!task) {
      return;
    }
    const oldStatus = task.status ?? null;

    await this.setStatus(id, status);
    await this.recordEvent(id, oldStatus, status, meta);
  }

  async recordEvent(
    id: string,
    fromStatus: string | null,
    toStatus: string | null,
    meta?: Record<string, unknown>,
  ): Promise<void> {
    this.events.push({
      task_id: id,
      from_status: fromStatus,
      to_status: toStatus,
      metadata: meta ?? null,
      created_at: this.now().toISOString(),
    });
  }

  async cancel(id: string): Promise<{ task_id: string; status: string }> {
    const task = this.findById(id);

    enforceTrue(task, Error, "Task not found");
    enforceTrue(
      !["merged", "failed", "cancelled"].includes(task.status ?? ""),
      Error,
      `Cannot cancel task in ${task.status} state`,
    );
    await this.updateStatus(id, "cancelled", { cancelled_by: "user" });

    return { task_id: id, status: "cancelled" };
  }

  async markMerged(id: string): Promise<{ task_id: string; status: string }> {
    const task = this.findById(id);

    enforceTrue(task, Error, "Task not found");
    enforceTrue(
      !(task.status !== "pr-created" && task.status !== "review"),
      Error,
      `Cannot mark task as merged from ${task.status} state (expected pr-created or review)`,
    );
    await this.updateStatus(id, "merged", { merged_by: "manual" });

    return { task_id: id, status: "merged" };
  }

  async transition(
    id: string,
    action: TaskAction,
    meta?: TaskTransitionMeta,
  ): Promise<PipelineTask> {
    const task = this.findById(id);

    if (!task) {
      // Mirrors the Pg `rows[0] as PipelineTask` on a no-match UPDATE.
      return undefined as unknown as PipelineTask;
    }
    const claimedBy = action === "claim" ? (meta?.agentId ?? null) : null;

    task.status = NEXT_STATUS[action];
    // claimed_by = COALESCE($3, claimed_by)
    task.claimed_by = claimedBy ?? task.claimed_by;
    task.updated_at = this.now().toISOString();

    return task as unknown as PipelineTask;
  }

  async findOpenLike(input: FindOpenLikeInput): Promise<PipelineTask[]> {
    const pattern = likeToRegExp(`${input.descriptionPrefix}%`);

    return this.tasks.filter(
      (t) =>
        t.target_repo === input.repo &&
        t.task_type === input.taskType &&
        pattern.test(t.description ?? "") &&
        input.statuses.includes(t.status ?? ""),
    ) as unknown as PipelineTask[];
  }

  async driftTasksForSpec(
    repo: string,
    taskType: string,
    specPath: string,
  ): Promise<DriftTaskRow[]> {
    // context_bundle->>'spec_path' extracts text; a NULL bundle matches nothing.
    return this.tasks
      .filter(
        (t) =>
          t.target_repo === repo &&
          t.task_type === taskType &&
          t.context_bundle?.["spec_path"] != null &&
          String(t.context_bundle["spec_path"]) === specPath,
      )
      .map((t) => ({
        status: t.status ?? "",
        created_at: t.created_at ?? "",
        issue_number: t.issue_number ?? null,
      }));
  }

  private byStatus(repo: string, statuses: string[]): PipelineTask[] {
    return this.tasks
      .filter(
        (t) => t.target_repo === repo && statuses.includes(t.status ?? ""),
      )
      .sort((a, b) =>
        (b.created_at ?? "").localeCompare(a.created_at ?? ""),
      ) as unknown as PipelineTask[];
  }

  private findById(id: string): SeedStoreTask | undefined {
    return this.tasks.find((t) => t.id === id);
  }
}
