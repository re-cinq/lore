import { unblockedBy } from "./task-queue-port.js";
import type {
  ReadySpecTask,
  CompletedSpecTask,
  SpecGroupCount,
} from "./task-queue-port.js";
import type { SeedTask } from "./task-queue-memory.js";

const isRunningOrQueued = (status?: string): boolean =>
  status === "running" || status === "queued";

const specTaskIdOf = (task: SeedTask): string | undefined =>
  task.context_bundle?.spec_task_id as string | undefined;
const specSlugOf = (task: SeedTask): string | undefined =>
  task.context_bundle?.spec_slug as string | undefined;

function isSatisfyingDependency(
  dep: SeedTask,
  task: SeedTask,
  depId: string,
): boolean {
  const sameRepoAndSlug =
    dep.target_repo === task.target_repo &&
    specSlugOf(dep) === specSlugOf(task);
  const isDone = dep.status === "completed" || dep.status === "merged";

  return sameRepoAndSlug && specTaskIdOf(dep) === depId && isDone;
}

function dependencySatisfied(
  specTasks: SeedTask[],
  task: SeedTask,
  depId: string,
): boolean {
  return specTasks.some((dep) => isSatisfyingDependency(dep, task, depId));
}

/** The spec-task DAG dispatch mechanics of {@link InMemoryTaskQueue} — readiness (dependencies satisfied), per-group running counts, claim, and completion-unblocks-next. Shares the SAME `tasks` array reference the main queue owns. */
export class SpecTaskStore {
  constructor(private readonly tasks: SeedTask[]) {}

  async findReadySpecTasks(repo?: string): Promise<ReadySpecTask[]> {
    const specTasks = this.tasks.filter((t) => t.task_type === "spec-task");

    return specTasks
      .filter((t) => {
        if (t.status !== "pending") {
          return false;
        }

        if (repo && t.target_repo !== repo) {
          return false;
        }
        const deps =
          (t.context_bundle?.depends_on as string[] | undefined) ?? [];

        return deps.every((depId) => dependencySatisfied(specTasks, t, depId));
      })
      .sort((a, b) =>
        String(a.context_bundle?.spec_task_id ?? "").localeCompare(
          String(b.context_bundle?.spec_task_id ?? ""),
        ),
      )
      .map((t) => ({
        id: t.id,
        description: t.description ?? "",
        context_bundle: t.context_bundle ?? null,
        target_repo: t.target_repo ?? "",
        task_group_id: t.task_group_id ?? null,
      }));
  }

  async countRunningSpecTasksByGroup(): Promise<SpecGroupCount[]> {
    const counts = new Map<string, number>();

    for (const t of this.tasks) {
      if (t.task_type !== "spec-task" || !isRunningOrQueued(t.status)) {
        continue;
      }

      if (t.task_group_id == null) {
        continue;
      }
      counts.set(t.task_group_id, (counts.get(t.task_group_id) ?? 0) + 1);
    }

    return [...counts.entries()].map(([task_group_id, cnt]) => ({
      task_group_id,
      cnt: String(cnt),
    }));
  }

  async countUnmergedInGroup(groupId: string): Promise<number> {
    return this.tasks.filter(
      (t) => t.task_group_id === groupId && t.status !== "merged",
    ).length;
  }

  async claimSpecTask(
    id: string,
    agentId = "spec-task-executor",
  ): Promise<boolean> {
    const task = this.tasks.find((t) => t.id === id);

    if (!task || task.status !== "pending") {
      return false;
    }
    task.status = "running";
    task.agent_id = agentId;

    return true;
  }

  async completeSpecTask(id: string): Promise<CompletedSpecTask> {
    const task = this.tasks.find((t) => t.id === id);

    if (!task || task.status !== "running") {
      return { completed: false, unblocked: [] };
    }
    task.status = "completed";

    const specTaskId = specTaskIdOf(task);
    const specSlug = specSlugOf(task);

    if (!specTaskId || !specSlug) {
      return { completed: true, unblocked: [] };
    }

    const ready = await this.findReadySpecTasks(task.target_repo);

    return {
      completed: true,
      unblocked: unblockedBy(ready, specSlug, specTaskId),
    };
  }

  async hasSpecTasksForSlug(repo: string, slug: string): Promise<boolean> {
    return this.tasks.some(
      (t) =>
        t.task_type === "spec-task" &&
        t.target_repo === repo &&
        (t.context_bundle as { spec_slug?: string } | null)?.spec_slug === slug,
    );
  }
}
