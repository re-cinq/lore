import type { PipelineTask } from "../../types.js";
import {
  PENDING_STATUSES,
  RUNNING_STATUSES,
  EXECUTED_STATUSES,
  type TaskWithEvents,
  type TaskListResult,
  type FindOpenLikeInput,
  type DriftTaskRow,
  type FeatureTaskRow,
} from "./task-store-port.js";
import type { SeedStoreTask, StoredTaskEvent } from "./task-store-memory.js";

function listRowIdentity(t: SeedStoreTask) {
  return {
    id: t.id,
    description: t.description ?? "",
    task_type: t.task_type ?? "",
    status: t.status ?? "",
  };
}

function listRowRepo(t: SeedStoreTask) {
  return {
    target_repo: t.target_repo ?? null,
    agent_id: t.agent_id ?? null,
    pr_url: t.pr_url ?? null,
  };
}

function listRowTimestamps(t: SeedStoreTask) {
  return {
    created_by: t.created_by ?? "",
    created_at: t.created_at ?? "",
    updated_at: t.updated_at ?? "",
  };
}

/** listTasks selects the 10-column TaskListRow subset, not SELECT * — fields outside it (context_bundle, priority, …) are absent in Pg too. */
function toListRow(t: SeedStoreTask) {
  return {
    ...listRowIdentity(t),
    ...listRowRepo(t),
    ...listRowTimestamps(t),
  };
}

/** Translates a SQL LIKE pattern to a RegExp, including the quirk that the Pg adapter doesn't escape %/_ in the caller's prefix — they act as wildcards there too. */
function likeToRegExp(pattern: string): RegExp {
  const source = pattern
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/%/g, ".*")
    .replace(/_/g, ".");

  return new RegExp(`^${source}$`);
}

/** The read surface of {@link InMemoryTaskStore} — status-bucket listings, the paginated task list, drift/feature lookups, and task+events join. Shares the SAME `tasks`/`events` arrays the main store owns. */
export class TaskQueryStore {
  constructor(
    private readonly tasks: SeedStoreTask[],
    private readonly events: StoredTaskEvent[],
  ) {}

  private findById(id: string): SeedStoreTask | undefined {
    return this.tasks.find((t) => t.id === id);
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

  async pending(repo: string): Promise<PipelineTask[]> {
    return this.byStatus(repo, PENDING_STATUSES);
  }

  async running(repo: string): Promise<PipelineTask[]> {
    return this.byStatus(repo, RUNNING_STATUSES);
  }

  async executed(repo: string): Promise<PipelineTask[]> {
    return this.byStatus(repo, EXECUTED_STATUSES);
  }

  async list(status?: string, limit = 50): Promise<TaskListResult> {
    const matching = this.tasks
      .filter((t) => !status || t.status === status)
      .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
    const rows = matching.slice(0, limit).map(toListRow);

    return {
      tasks: rows as unknown as PipelineTask[],
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

  async specTasksForFeature(
    repo: string,
    featureId: string,
  ): Promise<FeatureTaskRow[]> {
    // context_bundle->>'feature_id' extracts text; a NULL bundle matches nothing.
    return this.tasks
      .filter(
        (t) =>
          t.target_repo === repo &&
          t.task_type === "spec-task" &&
          t.context_bundle?.["feature_id"] != null &&
          String(t.context_bundle["feature_id"]) === featureId,
      )
      .map((t) => ({
        description: t.description ?? "",
        status: t.status ?? "",
        context_bundle: t.context_bundle ?? null,
      }))
      .sort((a, b) =>
        String(a.context_bundle?.["spec_task_id"] ?? "").localeCompare(
          String(b.context_bundle?.["spec_task_id"] ?? ""),
        ),
      );
  }
}
