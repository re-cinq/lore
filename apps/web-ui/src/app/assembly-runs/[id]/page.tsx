export const dynamic = "force-dynamic";
import { getTask } from "@/lib/api/tasks";
import { redirect } from "next/navigation";
import { fetchAssemblyRun, fetchAssemblyRunNodes } from "@/lib/assembly-runs";
import { fetchTaskEvents, fetchLlmCalls } from "@/lib/task-runtime";
import { definitionForRun } from "@/lib/run-graph-definition";
import { Alert } from "@/components/Alert";
import AssemblyRunView from "./AssemblyRunView";
import RunVisualizationPanel from "./RunVisualizationPanel";
import { AssemblyRunOptions } from "./AssemblyRunOptions";
import EventTimeline from "@/app/tasks/[id]/EventTimeline";
import LlmCallsTable from "@/app/tasks/[id]/LlmCallsTable";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolver for `/assembly-runs/[id]`. The id disambiguates itself: a
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

  const run = await fetchAssemblyRun(id);

  if (!run) {
    // The id may be a TASK id rather than a run id — the old links pointed here.
    const taskResult = await getTask(id);

    if (taskResult.status === "ok") {
      redirect(`/tasks/${id}`);
    }

    return <p>Not found.</p>;
  }

  const nodes = await fetchAssemblyRunNodes(id);
  const [events, llmCalls] = run.taskId
    ? await Promise.all([
        fetchTaskEvents(run.taskId),
        fetchLlmCalls(run.taskId),
      ])
    : [[], []];
  const { definition } = definitionForRun(run.blueprintName, nodes, run.graph);

  return (
    <>
      <AssemblyRunView run={run} />
      <AssemblyRunOptions run={run} />
      <RunVisualizationPanel
        runId={run.id}
        runStatus={run.status}
        startedAt={run.startedAt}
        definition={definition}
        nodes={nodes}
        repo={run.repo}
        reason={run.reason}
      />

      {run.taskId && (
        <>
          <EventTimeline events={events} />
          <LlmCallsTable llmCalls={llmCalls} repo={run.repo} />
        </>
      )}

      {!run.taskId && (
        <Alert variant="secondary">
          This run has no backing task — cost and status-transition history are
          not available.
        </Alert>
      )}
    </>
  );
}
