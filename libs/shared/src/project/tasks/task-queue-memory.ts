import type { PipelineTask } from "../../types.js";
import type {
  TaskQueueRepository,
  RecoverableTask,
  StaleTask,
  ReadySpecTask,
  SpecGroupCount,
} from "./task-queue-port.js";

/**
 * Seed row for {@link InMemoryTaskQueue}. A loose superset of the `pipeline.tasks`
 * columns the queue mechanics read — tests set only the fields they exercise.
 */
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
  [key: string]: unknown;
}

const GRACE_MS = 30 * 1000;

const ms = (ts: string | undefined): number => (ts ? new Date(ts).getTime() : 0);
const isRunningOrQueued = (status?: string): boolean =>
  status === "running" || status === "queued";

/**
 * In-memory {@link TaskQueueRepository}: the behavioral spec of the Pg adapter,
 * computed over seeded rows. `now` is injectable so age-dependent sweeps are
 * deterministic in tests. The default clock is `Date.now`.
 */
export class InMemoryTaskQueue implements TaskQueueRepository {
  constructor(
    public tasks: SeedTask[] = [],
    private readonly now: () => number = () => Date.now(),
  ) {}

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

  async findReadySpecTasks(): Promise<ReadySpecTask[]> {
    const specTasks = this.tasks.filter((t) => t.task_type === "spec-task");
    const depSatisfied = (task: SeedTask, depId: string): boolean =>
      specTasks.some(
        (d) =>
          d.target_repo === task.target_repo &&
          d.context_bundle?.spec_task_id === depId &&
          d.context_bundle?.spec_slug === task.context_bundle?.spec_slug &&
          (d.status === "completed" || d.status === "merged"),
      );
    return specTasks
      .filter((t) => {
        if (t.status !== "pending") return false;
        const deps = (t.context_bundle?.depends_on as string[] | undefined) ?? [];
        return deps.every((depId) => depSatisfied(t, depId));
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
      if (t.task_type !== "spec-task" || !isRunningOrQueued(t.status)) continue;
      if (t.task_group_id == null) continue;
      counts.set(t.task_group_id, (counts.get(t.task_group_id) ?? 0) + 1);
    }
    return [...counts.entries()].map(([task_group_id, cnt]) => ({
      task_group_id,
      cnt: String(cnt),
    }));
  }

  async claimSpecTask(id: string): Promise<boolean> {
    const task = this.tasks.find((t) => t.id === id);
    if (!task || task.status !== "pending") return false;
    task.status = "running";
    task.agent_id = "spec-task-executor";
    return true;
  }
}
