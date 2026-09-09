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

function TaskLessRunAlert() {
  return (
    <Alert variant="secondary">
      This run has no backing task — cost and status-transition history are not
      available.
    </Alert>
  );
}

interface TaskContextSectionProps {
  taskId: string | null;
  events: Awaited<ReturnType<typeof fetchTaskEvents>>;
  llmCalls: Awaited<ReturnType<typeof fetchLlmCalls>>;
  repo: string;
}

function TaskContextSection({
  taskId,
  events,
  llmCalls,
  repo,
}: TaskContextSectionProps) {
  if (!taskId) {
    return <TaskLessRunAlert />;
  }

  return (
    <>
      <EventTimeline events={events} />
      <LlmCallsTable llmCalls={llmCalls} repo={repo} />
    </>
  );
}

/** Everything the page renders from, resolved in one place. `agentEditHrefs` is built from RESOLVED definitions because those carry the `project_id` the "Edit agent" link routes on; `listAgents` degrades to an empty list when the API is unreachable, which costs the links and nothing else. */
async function resolveRunView(
  run: NonNullable<Awaited<ReturnType<typeof resolveRun>>>,
  id: string,
) {
  const nodes = await fetchAssemblyRunNodes(id);
  const { events, llmCalls } = await resolveTaskContext(run.taskId);
  const { definition } = definitionForRun(run.blueprintName, nodes, run.graph);

  return {
    nodes,
    events,
    llmCalls,
    definition,
    editHrefs: agentEditHrefs(definition, await listAgents(run.repo), run.repo),
  };
}

/** The run page proper, once the id has resolved to a run. */
interface RunPageProps {
  run: NonNullable<Awaited<ReturnType<typeof resolveRun>>>;
  view: Awaited<ReturnType<typeof resolveRunView>>;
}

function RunVisualization({ run, view }: RunPageProps) {
  return (
    <RunVisualizationPanel
      runId={run.id}
      runStatus={run.status}
      startedAt={run.startedAt}
      definition={view.definition}
      nodes={view.nodes}
      repo={run.repo}
      reason={run.reason}
      agentEditHrefs={view.editHrefs}
    />
  );
}

function RunPage({ run, view }: RunPageProps) {
  return (
    <>
      <RunAutoRefresh runStatus={run.status} />
      <AssemblyRunView run={run} />
      <AssemblyRunOptions run={run} />
      <RunVisualization run={run} view={view} />

      <TaskContextSection
        taskId={run.taskId}
        events={view.events}
        llmCalls={view.llmCalls}
        repo={run.repo}
      />
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

  return <RunPage run={run} view={await resolveRunView(run, id)} />;
}
