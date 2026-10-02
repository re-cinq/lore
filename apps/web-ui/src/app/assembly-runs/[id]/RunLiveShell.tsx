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
import type { Issue } from "@/lib/api/issues";
import AssemblyRunView from "./AssemblyRunView";
import RunIssueCard from "./RunIssueCard";
import DefinitionOfDonePanel from "./DefinitionOfDonePanel";
import { AssemblyRunOptions } from "./AssemblyRunOptions";
import RunVisualizationPanel from "./RunVisualizationPanel";
import { waitingOnPerson } from "@/lib/human-station";
import LlmCallsTable from "@/app/tasks/[id]/LlmCallsTable";

export interface RunLiveShellProps {
  run: AssemblyRun;
  nodes: readonly AssemblyRunNode[];
  definition: AssemblyLineDefinition | null;
  taskEvents: readonly TaskRuntimeEvent[];
  llmCalls: readonly TaskRuntimeLlmCall[];
  agentEditHrefs?: Record<string, string>;
  nodeModels?: Record<string, NodeModel>;
  /** The issue the run works on, read server-side; null when the run names none or GitHub could not answer. */
  issue?: Issue | null;
}

export default function RunLiveShell(props: RunLiveShellProps) {
  const [live, applyFrame] = useReducer(reduceRunLive, props, (seed) =>
    initialRunLive(seed.run, seed.nodes, seed.taskEvents),
  );
  const run = withLiveFacts(props.run, live.run);

  return (
    <>
      <RunHeader run={run} definition={props.definition} nodes={live.nodes} />
      <RunIssueCard issue={props.issue ?? null} />
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

/** The run's header, reading whose move it is while only people hold the open run. */
function RunHeader(props: {
  run: AssemblyRun;
  definition: RunLiveShellProps["definition"];
  nodes: readonly AssemblyRunNode[];
}) {
  return (
    <AssemblyRunView
      run={props.run}
      waitingOn={waitingOnPerson(props.definition, props.nodes)}
    />
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
        costUsd={run.costUsd}
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
    runOutcome: run.outcome,
    prNumber: run.prNumber,
    engine: run.engine,
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
  costUsd: number | null;
}

/** The task's cost table; its status transitions now live inside the selected node's transcript. */
function TaskContextSection(props: TaskContextProps) {
  const { taskId, llmCalls, repo, costUsd } = props;

  if (!taskId) {
    return <TaskLessRunAlert costKnown={costUsd !== null} />;
  }

  return <LlmCallsTable llmCalls={[...llmCalls]} repo={repo} />;
}

/** A task-less run (a code-review one, or a floor run) keeps no status-transition history; its cost is still said when the run row carries one. */
function TaskLessRunAlert({ costKnown }: { costKnown: boolean }) {
  return (
    <Alert variant="secondary">
      {costKnown
        ? "This run has no backing task — status-transition history is not available."
        : "This run has no backing task — cost and status-transition history are not available."}
    </Alert>
  );
}
