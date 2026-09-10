"use client";

// The page's live half (run-viz FR7.8): seeded from the server render, folded forward by the stream's state frames. Replaces the 10-second router.refresh() — the header pill, the node rows and the task events now change in place, and a terminal run needs no reload to read as finished.
import { useReducer } from "react";
import type { AssemblyLineDefinition } from "@/lib/assembly-line-definition";
import type { AssemblyRun, AssemblyRunNode } from "@/lib/assembly-runs";
import {
  initialRunLive,
  reduceRunLive,
  withLiveFacts,
} from "@/lib/run-live-reducer";
import type { TaskRuntimeEvent, TaskRuntimeLlmCall } from "@/lib/task-runtime";
import type { RunStreamFrame } from "@/lib/run-stream-types";
import type { NodeModel } from "@/lib/node-models";
import { Alert } from "@/components/Alert";
import AssemblyRunView from "./AssemblyRunView";
import DefinitionOfDonePanel from "./DefinitionOfDonePanel";
import { AssemblyRunOptions } from "./AssemblyRunOptions";
import RunVisualizationPanel from "./RunVisualizationPanel";
import LlmCallsTable from "@/app/tasks/[id]/LlmCallsTable";

export interface RunLiveShellProps {
  run: AssemblyRun;
  nodes: readonly AssemblyRunNode[];
  definition: AssemblyLineDefinition | null;
  taskEvents: readonly TaskRuntimeEvent[];
  llmCalls: readonly TaskRuntimeLlmCall[];
  agentEditHrefs?: Record<string, string>;
  nodeModels?: Record<string, NodeModel>;
}

export default function RunLiveShell(props: RunLiveShellProps) {
  const [live, applyFrame] = useReducer(reduceRunLive, props, (seed) =>
    initialRunLive(seed.run, seed.nodes, seed.taskEvents),
  );
  const run = withLiveFacts(props.run, live.run);

  return (
    <>
      <AssemblyRunView run={run} />
      <DefinitionOfDonePanel runId={run.id} refreshKey={dodRefreshKey(live)} />
      <AssemblyRunOptions run={run} />
      <LiveSections
        props={props}
        run={run}
        live={live}
        applyFrame={applyFrame}
      />
    </>
  );
}

/** Changes when the run's status or its CI check moved — the two moments the definition of done can read differently. */
function dodRefreshKey(live: ReturnType<typeof initialRunLive>): string {
  return `${live.run.status}:${live.ciCheck?.observed_at ?? ""}`;
}

/** The live-driven half below the header: the panel that owns the socket, and the task accounting fed by the same fold. */
interface LiveSectionsProps {
  props: RunLiveShellProps;
  run: AssemblyRun;
  live: ReturnType<typeof initialRunLive>;
  applyFrame: (frame: RunStreamFrame) => void;
}

function LiveSections(sections: LiveSectionsProps) {
  const { props, run } = sections;

  return (
    <>
      <RunVisualizationPanel {...panelProps(sections)} />
      <TaskContextSection
        taskId={run.taskId}
        llmCalls={props.llmCalls}
        repo={run.repo}
      />
    </>
  );
}

/** The panel's props from the shell's facts: the page's own inputs plus the live rows and the fold that feeds them. */
function panelProps({ props, run, live, applyFrame }: LiveSectionsProps) {
  return {
    runId: run.id,
    runStatus: run.status,
    definition: props.definition,
    nodes: live.nodes,
    repo: run.repo,
    reason: run.reason,
    prNumber: run.prNumber,
    agentEditHrefs: props.agentEditHrefs,
    nodeModels: props.nodeModels,
    taskEvents: live.taskEvents,
    onFrame: applyFrame,
  };
}

interface TaskContextProps {
  taskId: string | null;
  llmCalls: readonly TaskRuntimeLlmCall[];
  repo: string;
}

/** The task's cost table; its status transitions now live inside the selected node's transcript. */
function TaskContextSection({ taskId, llmCalls, repo }: TaskContextProps) {
  if (!taskId) {
    return <TaskLessRunAlert />;
  }

  return <LlmCallsTable llmCalls={[...llmCalls]} repo={repo} />;
}

function TaskLessRunAlert() {
  return (
    <Alert variant="secondary">
      This run has no backing task — cost and status-transition history are not
      available.
    </Alert>
  );
}
