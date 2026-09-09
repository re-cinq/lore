import { randomUUID } from "node:crypto";
import { enforceTrue } from "../../../lib/enforce.js";
import type { PipelineTask } from "../../../domain/types.js";
import {
  enforceTrustAllowsTaskType,
  type CreateTaskInput,
  type CreatedTask,
  type RetriedTask,
} from "../../../domain/pipeline-tasks.js";
import type {
  TaskStorePort,
  TaskAction,
  TaskTransitionMeta,
  TaskWithEvents,
  TaskListResult,
  FindOpenLikeInput,
  DriftTaskRow,
  FeatureTaskRow,
} from "./task-store-port.js";
import { TaskTransitionStore } from "./task-store-memory-transitions.js";
import { TaskQueryStore } from "./task-store-memory-queries.js";

/** Seed row for InMemoryTaskStore — a loose superset of the pipeline.tasks columns the store reads; tests set only what they exercise. */
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
export type SeedRepoSettings = Record<
  string,
  { trust?: { level?: string } } | undefined
>;

/** The create-time fields resolved from a {@link CreateTaskInput} before the row is built. */
type CreateFields = {
  taskType: string;
  repo: string | undefined;
  createdBy: string;
  priority: string;
  createdAt: string;
};

function createdFrom(fields: CreateFields, id: string): CreatedTask {
  return {
    task_id: id,
    task_type: fields.taskType,
    status: "pending",
    priority: fields.priority,
    created_at: fields.createdAt,
  };
}

/** In-memory TaskStorePort — behavioral spec of the Pg adapter (four inline queries + delegated pipeline-tasks.ts CRUD) over seeded rows; JSONB stored parsed (matching node-pg). now is injectable for deterministic ordering. */
export class InMemoryTaskStore implements TaskStorePort {
  readonly events: StoredTaskEvent[] = [];
  private readonly repoSettings: SeedRepoSettings;
  private readonly now: () => Date;
  private readonly transitions: TaskTransitionStore;
  private readonly queries: TaskQueryStore;

  constructor(
    public readonly tasks: SeedStoreTask[] = [],
    opts: { repoSettings?: SeedRepoSettings; now?: () => Date } = {},
  ) {
    this.repoSettings = opts.repoSettings ?? {};
    this.now = opts.now ?? (() => new Date());
    this.transitions = new TaskTransitionStore(
      this.tasks,
      this.events,
      this.now,
    );
    this.queries = new TaskQueryStore(this.tasks, this.events);
  }

  pending(repo: string): Promise<PipelineTask[]> {
    return this.queries.pending(repo);
  }

  running(repo: string): Promise<PipelineTask[]> {
    return this.queries.running(repo);
  }

  executed(repo: string): Promise<PipelineTask[]> {
    return this.queries.executed(repo);
  }

  async getById(id: string): Promise<PipelineTask | null> {
    return (this.findById(id) as PipelineTask | undefined) ?? null;
  }

  /** Gate only fires for a seeded repo row — mirrors the Pg read of lore.repos, where an absent row (or read error) skips the check. */
  private enforceTrustGate(repo: string | undefined, taskType: string): void {
    if (repo && this.repoSettings[repo]) {
      enforceTrustAllowsTaskType(
        this.repoSettings[repo].trust?.level,
        taskType,
        repo,
      );
    }
  }

  private buildTaskRow(
    input: CreateTaskInput,
    fields: CreateFields,
  ): SeedStoreTask {
    const task: SeedStoreTask = {
      id: randomUUID(),
      description: input.description,
      task_type: fields.taskType,
      target_repo: fields.repo ?? null,
      // `status` comes from the pipeline.tasks column default.
      status: "pending",
      created_by: fields.createdBy,
      context_bundle: input.contextBundle ?? null,
      priority: fields.priority,
      created_at: fields.createdAt,
      updated_at: fields.createdAt,
    };

    return input.taskGroupId
      ? { ...task, task_group_id: input.taskGroupId }
      : task;
  }

  private applyContextRefs(task: SeedStoreTask, input: CreateTaskInput): void {
    const refs = input.contextRefs;
    const hasRefs =
      refs && (refs.fact_ids.length > 0 || refs.memory_ids.length > 0);

    if (hasRefs) {
      task.context_refs = refs;
    }
  }

  /** Mirrors the Pg path's create-time gates exactly — a double that accepts what production refuses tests nothing. */
  private enforceCreatable(
    input: CreateTaskInput,
    repo: string | undefined,
    taskType: string,
  ): void {
    enforceTrue(
      input.description.length <= 10000,
      Error,
      "Description too long (max 10000 chars)",
    );
    this.enforceTrustGate(repo, taskType);
  }

  async create(input: CreateTaskInput): Promise<CreatedTask> {
    const fields: CreateFields = {
      taskType: input.taskType ?? "general",
      repo: input.targetRepo,
      createdBy: input.createdBy ?? "ui",
      priority: input.priority === "immediate" ? "immediate" : "normal",
      createdAt: this.now().toISOString(),
    };

    this.enforceCreatable(input, fields.repo, fields.taskType);

    const task = this.buildTaskRow(input, fields);

    this.tasks.push(task);
    this.applyContextRefs(task, input);
    await this.transitions.recordEvent(task.id, null, "pending", {
      created_by: fields.createdBy,
      priority: fields.priority,
    });

    return createdFrom(fields, task.id);
  }

  async retry(id: string): Promise<RetriedTask> {
    const task = this.findById(id);

    enforceTrue(task, Error, "Task not found");
    enforceTrue(
      task.status === "failed" || task.status === "needs-human-help",
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

    await this.transitions.updateStatus(id, "retried", {
      retried_as: result.task_id,
    });

    return { task_id: result.task_id, status: result.status, retry_of: id };
  }

  list(status?: string, limit = 50): Promise<TaskListResult> {
    return this.queries.list(status, limit);
  }

  getWithEvents(id: string): Promise<TaskWithEvents | null> {
    return this.queries.getWithEvents(id);
  }

  setStatus(
    id: string,
    status: string,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    return this.transitions.setStatus(id, status, extra);
  }

  setStatusIf(
    id: string,
    expectedStatus: string,
    status: string,
    extra: Record<string, unknown> = {},
  ): Promise<boolean> {
    return this.transitions.setStatusIf(id, expectedStatus, status, extra);
  }

  updateStatus(
    id: string,
    status: string,
    meta?: Record<string, unknown>,
  ): Promise<void> {
    return this.transitions.updateStatus(id, status, meta);
  }

  recordEvent(
    id: string,
    fromStatus: string | null,
    toStatus: string | null,
    meta?: Record<string, unknown>,
  ): Promise<void> {
    return this.transitions.recordEvent(id, fromStatus, toStatus, meta);
  }

  cancel(id: string): Promise<{ task_id: string; status: string }> {
    return this.transitions.cancel(id);
  }

  markMerged(id: string): Promise<{ task_id: string; status: string }> {
    return this.transitions.markMerged(id);
  }

  transition(
    id: string,
    action: TaskAction,
    meta?: TaskTransitionMeta,
  ): Promise<PipelineTask> {
    return this.transitions.transition(id, action, meta);
  }

  findOpenLike(input: FindOpenLikeInput): Promise<PipelineTask[]> {
    return this.queries.findOpenLike(input);
  }

  driftTasksForSpec(
    repo: string,
    taskType: string,
    specPath: string,
  ): Promise<DriftTaskRow[]> {
    return this.queries.driftTasksForSpec(repo, taskType, specPath);
  }

  specTasksForFeature(
    repo: string,
    featureId: string,
  ): Promise<FeatureTaskRow[]> {
    return this.queries.specTasksForFeature(repo, featureId);
  }

  private findById(id: string): SeedStoreTask | undefined {
    return this.tasks.find((t) => t.id === id);
  }
}
