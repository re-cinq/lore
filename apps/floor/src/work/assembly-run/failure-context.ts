import type {
  AssemblyRunRecord,
  StationRunRecord,
} from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import type { PipelineTask } from "@re-cinq/lore-shared";
import { pipeline, taskStore } from "../../outbound/queues.js";
import { namesFor } from "../digest/deps.js";

export type FailedNode = Pick<
  StationRunRecord,
  "nodeId" | "failureClass" | "failureDetail"
>;

/** What the run's rows and task add to a failure notice; any field may be unknown. */
export interface FailureContext {
  failedNode: FailedNode | null;
  owner: string | null;
  prUrl: string | null;
  issueUrl: string | null;
}

export const NO_FAILURE_CONTEXT: FailureContext = {
  failedNode: null,
  owner: null,
  prUrl: null,
  issueUrl: null,
};

export interface FailureContextDeps {
  stationRuns(assemblyRunId: string): Promise<StationRunRecord[]>;
  taskById(taskId: string): Promise<PipelineTask | null>;
  slackNameOf(repo: string, login: string): Promise<string | null>;
}

export async function failureContext(
  row: AssemblyRunRecord,
  deps: FailureContextDeps,
): Promise<FailureContext> {
  const [visits, task] = await Promise.all([
    deps.stationRuns(row.id),
    row.taskId ? deps.taskById(row.taskId) : null,
  ]);

  return {
    failedNode: lastFailedVisit(visits),
    owner: await ownerName(row, task, deps),
    prUrl: task?.pr_url ?? null,
    issueUrl: task?.issue_url ?? null,
  };
}

function lastFailedVisit(visits: StationRunRecord[]): FailedNode | null {
  const failed = visits.findLast((visit) => visit.outcome === "failed");

  if (!failed) {
    return null;
  }

  const { nodeId, failureClass, failureDetail } = failed;

  return { nodeId, failureClass, failureDetail };
}

const SLACK_CREATOR = "slack:";

/** The run's actor (the PR author or commenter), else whoever created its task; a Slack-created task already carries a Slack name. */
async function ownerName(
  row: AssemblyRunRecord,
  task: PipelineTask | null,
  deps: FailureContextDeps,
): Promise<string | null> {
  const login = ownerLogin(row, task);

  if (!login) {
    return null;
  }

  if (login.startsWith(SLACK_CREATOR)) {
    return login.slice(SLACK_CREATOR.length);
  }

  return (await deps.slackNameOf(row.repo, login)) ?? login;
}

function ownerLogin(
  row: AssemblyRunRecord,
  task: PipelineTask | null,
): string | null {
  const { actor } = row.args;

  if (typeof actor === "string" && actor) {
    return actor;
  }

  return task?.created_by || null;
}

export async function resolveFailureContext(
  row: AssemblyRunRecord,
): Promise<FailureContext> {
  return failureContext(row, {
    stationRuns: (runId) => pipeline().assemblyRuns.listStationRuns(runId),
    taskById: (taskId) => taskStore().getById(taskId),
    slackNameOf: async (repo, login) =>
      (await namesFor(repo, [login]))[login] ?? null,
  });
}
