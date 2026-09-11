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
import { resolveNodeModels } from "@/lib/node-models";
import { listAgents } from "@/lib/agents-api";
import { fetchIssue, type Issue } from "@/lib/api/issues";
import RunLiveShell from "./RunLiveShell";

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

  const run = await resolveRun(id);

  if (!run) {
    return <p>Not found.</p>;
  }

  return <RunPage run={run} view={await resolveRunView(run, id)} />;
}

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

/** Everything the page renders from, resolved in one place. `agentEditHrefs` is built from RESOLVED definitions because those carry the `project_id` the "Edit agent" link routes on; `listAgents` degrades to an empty list when the API is unreachable, which costs the links and nothing else. */
async function resolveRunView(
  run: NonNullable<Awaited<ReturnType<typeof resolveRun>>>,
  id: string,
) {
  const issueRead = resolveIssue(run);
  const nodes = await fetchAssemblyRunNodes(id);
  const { events, llmCalls } = await resolveTaskContext(run.taskId);
  const { definition } = definitionForRun(run.blueprintName, nodes, run.graph);
  const agents = await listAgents(run.repo);

  return {
    nodes,
    events,
    llmCalls,
    definition,
    editHrefs: agentEditHrefs(definition, agents, run.repo),
    nodeModels: resolveNodeModels(definition, agents),
    issue: await issueRead,
  };
}

/** The run page proper, once the id has resolved to a run. */
interface RunPageProps {
  run: NonNullable<Awaited<ReturnType<typeof resolveRun>>>;
  view: Awaited<ReturnType<typeof resolveRunView>>;
}

function RunPage({ run, view }: RunPageProps) {
  return (
    <RunLiveShell
      run={run}
      nodes={view.nodes}
      definition={view.definition}
      taskEvents={view.events}
      llmCalls={view.llmCalls}
      agentEditHrefs={view.editHrefs}
      nodeModels={view.nodeModels}
      issue={view.issue}
    />
  );
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

/** The issue the run works on, for the card that shows it in place; a run naming no issue, or a GitHub read that fails, costs the card and nothing else. */
async function resolveIssue(run: AssemblyRun): Promise<Issue | null> {
  if (!run.issueNumber) {
    return null;
  }

  const result = await fetchIssue(run.repo, run.issueNumber);

  return result.status === "ok" ? result.data : null;
}
