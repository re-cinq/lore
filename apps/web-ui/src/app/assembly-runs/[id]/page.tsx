export const dynamic = "force-dynamic";
import { getTask } from "@/lib/api/tasks";
import { redirect } from "next/navigation";
import {
  fetchAssemblyRun,
  fetchAssemblyRunNodes,
  type AssemblyRun,
} from "@/lib/assembly-runs";
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

// The id may be a TASK id rather than a run id — old links pointed here; redirects there and returns null.
async function resolveRun(id: string): Promise<AssemblyRun | null> {
  const run = await fetchAssemblyRun(id);

  if (run) {
    return run;
  }

  const taskResult = await getTask(id);

  if (taskResult.status === "ok") {
    redirect(`/tasks/${id}`);
  }

  return null;
}

async function resolveTaskContext(taskId: string | null) {
  if (!taskId) {
    return { events: [], llmCalls: [] };
  }

  const [events, llmCalls] = await Promise.all([
    fetchTaskEvents(taskId),
    fetchLlmCalls(taskId),
  ]);

  return { events, llmCalls };
}

function TaskContextSection({
  taskId,
  events,
  llmCalls,
  repo,
}: {
  taskId: string | null;
  events: Awaited<ReturnType<typeof fetchTaskEvents>>;
  llmCalls: Awaited<ReturnType<typeof fetchLlmCalls>>;
  repo: string;
}) {
  if (!taskId) {
    return (
      <Alert variant="secondary">
        This run has no backing task — cost and status-transition history are
        not available.
      </Alert>
    );
  }

  return (
    <>
      <EventTimeline events={events} />
      <LlmCallsTable llmCalls={llmCalls} repo={repo} />
    </>
  );
}

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

  const run = await resolveRun(id);

  if (!run) {
    return <p>Not found.</p>;
  }

  const nodes = await fetchAssemblyRunNodes(id);
  const { events, llmCalls } = await resolveTaskContext(run.taskId);
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

      <TaskContextSection
        taskId={run.taskId}
        events={events}
        llmCalls={llmCalls}
        repo={run.repo}
      />
    </>
  );
}
