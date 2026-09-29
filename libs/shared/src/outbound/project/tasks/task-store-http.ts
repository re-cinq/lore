import type { PipelineTask } from "../../../domain/types.js";
import { acceptEitherSpelling, type DbRow } from "../../../lib/row.js";
import { PIPELINE_TASK_COLUMNS } from "../../../domain/models/pipeline-task.js";
import type {
  DriftTaskRow,
  FindOpenLikeInput,
  CreateTaskInput,
  ReconcileSpecTasksInput,
  ReconciledSpecTasks,
} from "./task-store-port.js";

/** The repo-scoped API calls the task store makes; the station project's HTTP client. */
interface TaskHttp {
  get<T>(path: string, query?: Record<string, string>): Promise<T>;
  post<T>(path: string, body: unknown): Promise<T>;
  put<T>(path: string, body: unknown): Promise<T>;
}

/** TaskStorePort subset a station pod reaches over HTTP: driftTasksForSpec + findOpenLike + create + reconcileSpecTasks. */
export class TaskStoreHttp {
  constructor(private readonly http: TaskHttp) {}
  async driftTasksForSpec(
    _repo: string,
    taskType: string,
    specPath: string,
  ): Promise<DriftTaskRow[]> {
    return (
      await this.http.get<{ tasks: DriftTaskRow[] }>("/tasks/drift", {
        task_type: taskType,
        spec_path: specPath,
      })
    ).tasks;
  }
  /** Accept either spelling of pipeline.tasks fields for pod rollout tolerance. */
  async findOpenLike(input: FindOpenLikeInput): Promise<PipelineTask[]> {
    const { tasks } = await this.http.get<{ tasks: DbRow[] }>(
      "/tasks/open-like",
      {
        task_type: input.taskType,
        description_prefix: input.descriptionPrefix,
        statuses: [...input.statuses].join(","),
      },
    );

    return tasks.map(
      (task) =>
        acceptEitherSpelling(
          PIPELINE_TASK_COLUMNS,
          task,
        ) as unknown as PipelineTask,
    );
  }
  async create(input: CreateTaskInput): Promise<unknown> {
    return this.http.post("/tasks", {
      description: input.description,
      taskType: input.taskType,
      createdBy: input.createdBy,
      contextBundle: input.contextBundle,
      ...(input.taskGroupId ? { taskGroupId: input.taskGroupId } : {}),
      ...(input.issueNumber !== undefined
        ? { issueNumber: input.issueNumber, issueUrl: input.issueUrl }
        : {}),
    });
  }
  async reconcileSpecTasks(
    _repo: string,
    input: ReconcileSpecTasksInput,
  ): Promise<ReconciledSpecTasks> {
    return this.http.put<ReconciledSpecTasks>("/tasks/spec-tasks", input);
  }
}
