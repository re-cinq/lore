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

/** Only the visit the run ended on: lines route `failed` onward as normal flow, so an earlier failure may have been recovered from. */
function lastFailedVisit(visits: StationRunRecord[]): FailedNode | null {
  const last = visits.at(-1);

  if (last?.outcome !== "failed") {
    return null;
  }

  const { nodeId, failureClass, failureDetail } = last;

  return { nodeId, failureClass, failureDetail };
}

const SLACK_CREATOR = "slack:";
const RETRY_PREFIXES = /^(?:retry:)+/;

/** The run's actor is always a GitHub user (the PR author or commenter), so an unknown one keeps its login; else the task's creator. */
async function ownerName(
  row: AssemblyRunRecord,
  task: PipelineTask | null,
  deps: FailureContextDeps,
): Promise<string | null> {
  const { actor } = row.args;

  if (typeof actor === "string" && actor) {
    return (await deps.slackNameOf(row.repo, actor)) ?? actor;
  }

  return task ? creatorName(row.repo, task.created_by, deps) : null;
}

/** A creator is often a system label (`github-webhook`, `review-loop`), so only one Slack knows is shown; a Slack-created task already carries the Slack name. */
async function creatorName(
  repo: string,
  createdBy: string,
  deps: FailureContextDeps,
): Promise<string | null> {
  const creator = createdBy.replace(RETRY_PREFIXES, "");

  if (creator.startsWith(SLACK_CREATOR)) {
    return creator.slice(SLACK_CREATOR.length);
  }

  return creator ? deps.slackNameOf(repo, creator) : null;
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
