export const dynamic = "force-dynamic";
import { redirect } from "next/navigation";
import { queryOne } from "@/lib/db";
import {
  fetchAssemblyLineRun,
  fetchAssemblyLineRunNodes,
} from "@/lib/assembly-line-runs";
import { fetchTaskEvents, fetchLlmCalls } from "@/lib/task-runtime";
import { definitionForRun } from "@/lib/run-graph-definition";
import AssemblyLineRunView from "./AssemblyLineRunView";
import RunVisualizationPanel from "./RunVisualizationPanel";
import NodePodLogs from "./NodePodLogs";
import { TriggerReviewButton } from "./TriggerReviewButton";
import EventTimeline from "@/app/tasks/[id]/EventTimeline";
import LlmCallsTable from "@/app/tasks/[id]/LlmCallsTable";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolver for `/assembly-lines/[id]`. The id disambiguates itself: a
 * `pipeline.assembly_lines` run renders the run detail; otherwise a
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
    const logNodes = nodes
      .filter((n) => n.agentCrName)
      .map((n) => ({ nodeId: n.nodeId, agentCrName: n.agentCrName as string }));
    const [events, llmCalls] = run.taskId
      ? await Promise.all([
          fetchTaskEvents(run.taskId),
          fetchLlmCalls(run.taskId),
        ])
      : [[], []];
    const { definition, synthetic } = definitionForRun(
      run.definitionName,
      nodes,
    );

    return (
      <>
        <AssemblyLineRunView run={run} nodes={nodes} />
        {run.definitionName === "code-review" && run.prNumber ? (
          <TriggerReviewButton repo={run.repo} prNumber={run.prNumber} />
        ) : null}
        <RunVisualizationPanel
          runId={run.id}
          runStatus={run.status}
          definition={definition}
          showEdgeLabels={!synthetic}
          nodes={nodes}
        />
        <NodePodLogs assemblyLineId={run.id} nodes={logNodes} />
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

  const task = await queryOne<{ id: string }>(
    `SELECT id FROM pipeline.tasks WHERE id = $1`,
    [id],
  );

  if (task) {
    redirect(`/tasks/${id}`);
  }

  return <p>Not found.</p>;
}
