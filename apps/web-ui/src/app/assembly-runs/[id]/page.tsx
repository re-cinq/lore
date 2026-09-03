export const dynamic = "force-dynamic";
import { getTask } from "@/lib/api/tasks";
import { redirect } from "next/navigation";
import { fetchAssemblyRun, fetchAssemblyRunNodes } from "@/lib/assembly-runs";
import { fetchTaskEvents, fetchLlmCalls } from "@/lib/task-runtime";
import { definitionForRun } from "@/lib/run-graph-definition";
import { agentEditHrefs } from "@/lib/agent-edit-href";
import { listAgents } from "@/lib/agents-api";
import { Alert } from "@/components/Alert";
import AssemblyRunView from "./AssemblyRunView";
import { RunAutoRefresh } from "./RunAutoRefresh";
import RunVisualizationPanel from "./RunVisualizationPanel";
import { AssemblyRunOptions } from "./AssemblyRunOptions";
import EventTimeline from "@/app/tasks/[id]/EventTimeline";
import LlmCallsTable from "@/app/tasks/[id]/LlmCallsTable";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Resolver for `/assembly-runs/[id]`: a run renders detail; a task id redirects to `/tasks/[id]` (legacy links keep working); unknown → "Not found".
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
  // The id may be a TASK id rather than a run id — old links pointed here.
  const taskResult = run ? null : await getTask(id);

  if (!run && taskResult?.status === "ok") {
    redirect(`/tasks/${id}`);
  }

  if (!run) {
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
  // Resolved defs carry project_id, the discriminator "Edit agent" routes on; listAgents degrades to [] (no links) when the API is unreachable.
  const editHrefs = agentEditHrefs(
    definition,
    await listAgents(run.repo),
    run.repo,
  );

  return (
    <>
      <RunAutoRefresh runStatus={run.status} />
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
        agentEditHrefs={editHrefs}
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
