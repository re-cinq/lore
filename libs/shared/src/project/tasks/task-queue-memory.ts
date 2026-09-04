import type { PipelineTask } from "../../types.js";
import { enforceSettableTaskColumns } from "./task-queue-port.js";
import type {
  TaskQueueRepository,
  RecoverableTask,
  StaleTask,
  ReadySpecTask,
  CompletedSpecTask,
  SpecGroupCount,
  AwaitingApprovalTask,
  TaskPrInfo,
  ReviewableTask,
  MergeableTask,
  TaskContextRefs,
  InsertTaskInput,
} from "./task-queue-port.js";
import { SpecTaskStore } from "./task-queue-memory-spec-tasks.js";

/** Seed row for {@link InMemoryTaskQueue}: a loose superset of the pipeline.tasks columns the queue mechanics read; tests set only the fields they exercise. */
export interface SeedTask {
  id: string;
  status?: string;
  task_type?: string;
  priority?: string;
  created_at?: string;
  updated_at?: string;
  target_repo?: string;
  description?: string;
  issue_number?: number | null;
  task_group_id?: string | null;
  context_bundle?: Record<string, unknown> | null;
  pr_number?: number | null;
  target_branch?: string | null;
  pr_url?: string | null;
  [key: string]: unknown;
}

const GRACE_MS = 30 * 1000;

const ms = (ts: string | undefined): number =>
  ts ? new Date(ts).getTime() : 0;
const isRunningOrQueued = (status?: string): boolean =>
  status === "running" || status === "queued";
const orEmpty = (value: string | null | undefined): string => value ?? "";
const orNull = <T>(value: T | null | undefined): T | null => value ?? null;

function isMergeableFeatureRequestOnBranch(
  task: SeedTask,
  repo: string,
  branch: string,
): boolean {
  const isOnBranch = task.target_repo === repo && task.target_branch === branch;
  const isMergeable = task.status === "pr-created" || task.status === "review";

  return task.task_type === "feature-request" && isOnBranch && isMergeable;
}

/** In-memory {@link TaskQueueRepository}: behavioral spec of the Pg adapter over seeded rows; `now` is injectable for deterministic age-dependent sweeps in tests. */
export class InMemoryTaskQueue implements TaskQueueRepository {
  private readonly specTasks: SpecTaskStore;

  constructor(
    public tasks: SeedTask[] = [],
    private readonly now: () => number = () => Date.now(),
  ) {
    this.specTasks = new SpecTaskStore(this.tasks);
  }

  async claimNextPending(): Promise<PipelineTask | null> {
    const now = this.now();
    const runnable = this.tasks
      .filter(
        (t) =>
          t.status === "pending" &&
          (t.priority === "immediate" || ms(t.created_at) < now - GRACE_MS),
      )
      .sort((a, b) => {
        const ap = a.priority === "immediate" ? 0 : 1;
        const bp = b.priority === "immediate" ? 0 : 1;

        return ap !== bp ? ap - bp : ms(a.created_at) - ms(b.created_at);
      });

    return (runnable[0] as unknown as PipelineTask | undefined) ?? null;
  }

  async findRecoverable(maxAgeMinutes = 30): Promise<RecoverableTask[]> {
    const cutoff = this.now() - maxAgeMinutes * 60_000;

    return this.tasks
      .filter((t) => isRunningOrQueued(t.status) && ms(t.updated_at) < cutoff)
      .map((t) => ({ id: t.id, task_type: t.task_type ?? "" }));
  }

  async findStaleRunning(thresholdHours: number): Promise<StaleTask[]> {
    const now = this.now();
    const cutoff = now - thresholdHours * 3_600_000;

    return this.tasks
      .filter((t) => t.status === "running" && ms(t.created_at) < cutoff)
      .map((t) => ({
        id: t.id,
        target_repo: t.target_repo ?? "",
        task_type: t.task_type ?? "",
        created_at: t.created_at ?? "",
        issue_number: t.issue_number ?? null,
        age_hours: (now - ms(t.created_at)) / 3_600_000,
      }));
  }

  findReadySpecTasks(repo?: string): Promise<ReadySpecTask[]> {
    return this.specTasks.findReadySpecTasks(repo);
  }

  countRunningSpecTasksByGroup(): Promise<SpecGroupCount[]> {
    return this.specTasks.countRunningSpecTasksByGroup();
  }

  countUnmergedInGroup(groupId: string): Promise<number> {
    return this.specTasks.countUnmergedInGroup(groupId);
  }

  claimSpecTask(id: string, agentId = "spec-task-executor"): Promise<boolean> {
    return this.specTasks.claimSpecTask(id, agentId);
  }

  completeSpecTask(id: string): Promise<CompletedSpecTask> {
    return this.specTasks.completeSpecTask(id);
  }

  async awaitingApproval(): Promise<AwaitingApprovalTask[]> {
    return this.tasks
      .filter((t) => t.status === "awaiting_approval" && t.issue_number != null)
      .map((t) => ({
        id: t.id,
        target_repo: t.target_repo ?? "",
        issue_number: t.issue_number as number,
      }));
  }

  async distinctTargetRepos(): Promise<string[]> {
    const repos = new Set<string>();

    for (const t of this.tasks) {
      if (t.target_repo) {
        repos.add(t.target_repo);
      }
    }

    return [...repos].sort();
  }

  async prInfo(taskId: string): Promise<TaskPrInfo | null> {
    const task = this.tasks.find((t) => t.id === taskId);

    if (!task) {
      return null;
    }

    return {
      pr_number: task.pr_number ?? null,
      target_repo: task.target_repo ?? null,
      target_branch: task.target_branch ?? null,
    };
  }

  async reviewable(): Promise<ReviewableTask[]> {
    return this.tasks
      .filter((t) => this.isReviewable(t))
      .map((t) => this.toReviewable(t));
  }

  async reviewableForPR(
    repo: string,
    prNumber: number,
  ): Promise<ReviewableTask | null> {
    const task = this.tasks.find(
      (t) =>
        this.isReviewable(t) &&
        t.target_repo === repo &&
        t.pr_number === prNumber,
    );

    return task ? this.toReviewable(task) : null;
  }

  async incrementReviewIteration(taskId: string): Promise<number> {
    const task = this.tasks.find((t) => t.id === taskId);

    if (!task) {
      return 1;
    }
    const next =
      ((task.review_iteration as number | null | undefined) ?? 0) + 1;

    task.review_iteration = next;

    return next;
  }

  private isReviewable(t: SeedTask): boolean {
    const iteration = t.review_iteration as number | null | undefined;

    return (
      (t.status === "pr-created" ||
        t.status === "review" ||
        t.status === "revision-requested") &&
      t.pr_number != null &&
      (iteration == null || iteration < 3)
    );
  }

  private toReviewable(t: SeedTask): ReviewableTask {
    return {
      id: t.id,
      description: orEmpty(t.description as string | null | undefined),
      task_type: orEmpty(t.task_type),
      target_repo: orEmpty(t.target_repo),
      pr_number: t.pr_number as number,
      pr_url: orEmpty(t.pr_url as string | null | undefined),
      issue_number: orNull(t.issue_number),
      review_iteration: orNull(t.review_iteration as number | null | undefined),
      target_branch: orEmpty(t.target_branch as string | null | undefined),
    };
  }

  async mergeableTasks(): Promise<MergeableTask[]> {
    return this.tasks
      .filter(
        (t) =>
          (t.status === "pr-created" || t.status === "review") &&
          t.pr_number != null &&
          t.pr_url != null,
      )
      .map((t) => ({
        id: t.id,
        target_repo: orEmpty(t.target_repo),
        target_branch: orNull(t.target_branch as string | null | undefined),
        pr_url: t.pr_url as string,
        pr_number: t.pr_number as number,
        issue_number: orNull(t.issue_number),
        task_type: orEmpty(t.task_type),
        description: orEmpty(t.description as string | null | undefined),
        created_at: orEmpty(t.created_at),
        task_group_id: orNull(t.task_group_id),
        context_bundle: orNull(
          t.context_bundle as {
            feature_id?: string;
            slug?: string;
            spec_slug?: string;
          } | null,
        ),
      }));
  }

  hasSpecTasksForSlug(repo: string, slug: string): Promise<boolean> {
    return this.specTasks.hasSpecTasksForSlug(repo, slug);
  }

  async contextRefs(taskId: string): Promise<TaskContextRefs | null> {
    const task = this.tasks.find((t) => t.id === taskId);

    return (task?.context_refs as TaskContextRefs | undefined) ?? null;
  }

  async insertTask(input: InsertTaskInput): Promise<string | null> {
    const id = `task-${this.tasks.length + 1}`;

    this.tasks.push({
      id,
      description: input.description,
      task_type: input.taskType,
      target_repo: input.targetRepo,
      status: input.status ?? "pending",
      context_bundle:
        (input.contextBundle as Record<string, unknown> | null) ?? null,
      task_group_id: input.taskGroupId ?? null,
    });

    return id;
  }

  async setColumns(
    taskId: string,
    columns: Record<string, unknown>,
  ): Promise<void> {
    // Same allowlist gate as the Pg adapter — a typo'd column must not pass tests against this double while no-oping in prod.
    enforceSettableTaskColumns(columns);
    const task = this.tasks.find((t) => t.id === taskId);

    if (!task) {
      return;
    }
    Object.assign(task, columns);
  }

  async latestTaskByPr(
    repo: string,
    prNumber: number,
  ): Promise<{ id: string } | null> {
    const matches = this.tasks
      .filter((t) => t.target_repo === repo && t.pr_number === prNumber)
      .sort((a, b) => ms(b.created_at) - ms(a.created_at));

    return matches[0] ? { id: matches[0].id } : null;
  }

  async activeTaskByIssue(
    repo: string,
    issueNumber: number,
  ): Promise<{ id: string } | null> {
    const task = this.tasks.find(
      (t) =>
        t.issue_number === issueNumber &&
        t.target_repo === repo &&
        t.status !== "failed" &&
        t.status !== "cancelled",
    );

    return task ? { id: task.id } : null;
  }

  async markFeatureRequestMergedOnBranch(
    repo: string,
    branch: string,
  ): Promise<void> {
    for (const t of this.tasks) {
      if (isMergeableFeatureRequestOnBranch(t, repo, branch)) {
        t.status = "merged";
      }
    }
  }
}
