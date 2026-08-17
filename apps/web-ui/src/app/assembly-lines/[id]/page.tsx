export const dynamic = "force-dynamic";
import { getTask } from "@/lib/api/tasks";
import { redirect } from "next/navigation";
import {
  fetchAssemblyLineRun,
  fetchAssemblyLineRunNodes,
} from "@/lib/assembly-line-runs";
import { fetchTaskEvents, fetchLlmCalls } from "@/lib/task-runtime";
import { definitionForRun } from "@/lib/run-graph-definition";
import AssemblyLineRunView from "./AssemblyLineRunView";
import RunVisualizationPanel from "./RunVisualizationPanel";
import { TriggerReviewButton } from "./TriggerReviewButton";
import EventTimeline from "@/app/tasks/[id]/EventTimeline";
import LlmCallsTable from "@/app/tasks/[id]/LlmCallsTable";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolver for `/assembly-lines/[id]`. The id disambiguates itself: a
 * `pipeline.assembly_runs` run renders the run detail; otherwise a
 * `pipeline.tasks` row redirects to the task detail at `/tasks/[id]` (so every
 * legacy task-UUID link — UUID linkification, repo overview, GitHub comments —
 * keeps working). A non-UUID or unknown id renders "Not found".
 */
export default async function AssemblyLineResolverPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  if (!UUID_RE.test(id)) {
    return <p>Not found.</p>;
  }

  const run = await fetchAssemblyLineRun(id);

  if (run) {
    const nodes = await fetchAssemblyLineRunNodes(id);
    const [events, llmCalls] = run.taskId
      ? await Promise.all([
          fetchTaskEvents(run.taskId),
          fetchLlmCalls(run.taskId),
        ])
      : [[], []];
    const { definition } = definitionForRun(
      run.blueprintName,
      nodes,
      run.graph,
    );

    return (
      <>
        <AssemblyLineRunView run={run} />
        {run.blueprintName === "code-review" && run.prNumber ? (
          <TriggerReviewButton repo={run.repo} prNumber={run.prNumber} />
        ) : null}
        <RunVisualizationPanel
          runId={run.id}
          runStatus={run.status}
          startedAt={run.startedAt}
          definition={definition}
          nodes={nodes}
          repo={run.repo}
          reason={run.reason}
        />
        {run.taskId ? (
          <>
            <EventTimeline events={events} />
            <LlmCallsTable llmCalls={llmCalls} repo={run.repo} />
          </>
        ) : (
          <p className="meta">
            This run has no backing task — cost and status-transition history
            are not available.
          </p>
        )}
      </>
    );
  }

  // The id may be a TASK id rather than a run id — the old links pointed here.
  const taskResult = await getTask(id);

  if (taskResult.status === "ok") {
    redirect(`/tasks/${id}`);
  }

  return <p>Not found.</p>;
}
