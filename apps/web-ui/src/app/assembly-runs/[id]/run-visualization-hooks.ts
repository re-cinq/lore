// Derived-state hooks for RunVisualizationPanel: each takes the panel's raw state and memoizes one view of it (the ticking clock, the executed-path graph, the selected node's detail).
import { useEffect, useMemo, useState } from "react";
import type { AssemblyLineDefinition } from "@/lib/assembly-line-definition";
import type { AssemblyRunNode } from "@/lib/assembly-runs";
import type { NodeRunState } from "@/lib/run-event-reducer";
import { takenEdgeKeys } from "@/lib/run-taken-edges";
import { latestRowByNode } from "@/lib/run-replay-view";
import { deriveVisibleGraph, type RunData } from "@/lib/graph-view-model";
import { stepViews } from "@/lib/step-presenter";
import { retryResumeSource } from "./retry-resume";
import {
  buildRunData,
  computeGraphMode,
  computeHasRunData,
  pickSelectedState,
} from "./run-visualization-selectors";

/** A running node's duration is `now` minus its start — without a clock a stalled node would look identical to a live one. Ticks once a second while the run is live. */
export function useNowTicker({ live }: { live: boolean }): string {
  const [now, setNow] = useState(() => new Date().toISOString());

  useEffect(() => {
    if (!live) {
      return;
    }

    const id = setInterval(() => setNow(new Date().toISOString()), 1000);

    return () => clearInterval(id);
  }, [live]);

  return now;
}

/** The graph the page draws: which nodes ran and what each was told. */
interface RunGraphInput {
  nodes: readonly AssemblyRunNode[];
  definition: AssemblyLineDefinition | null;
  runStatus: string;
  runIsLive: boolean;
  selectedNodeId: string | null;
  showOutcomes: boolean;
  nodeStates: Readonly<Record<string, NodeRunState>>;
  takenEdges: RunData["taken"];
}

export function useRunGraph(input: RunGraphInput) {
  const { nodes, definition, nodeStates, showOutcomes } = input;
  const hasRunData = computeHasRunData(nodes.length, nodeStates);
  const latestRows = useMemo(() => latestRowByNode(nodes), [nodes]);
  const retrySource = useRetrySource(input);
  const runData = useRunData({ ...input, latestRows });
  const visibleGraph = useVisibleGraph({
    definition,
    hasRunData,
    runData,
    showOutcomes,
  });

  return { hasRunData, visibleGraph, retrySource, latestRows };
}

/** The graph as drawn. A run with no rows yet passes `null` run data on purpose — the definition alone renders as the plain shape of the line, rather than as every node wrongly reporting "not started". */
function useVisibleGraph(input: {
  definition: AssemblyLineDefinition | null;
  hasRunData: boolean;
  runData: RunData;
  showOutcomes: boolean;
}) {
  const { definition, hasRunData, runData } = input;
  const graphMode = computeGraphMode(input);

  return useMemo(
    () =>
      deriveVisibleGraph(definition, hasRunData ? runData : null, graphMode),
    [definition, hasRunData, runData, graphMode],
  );
}

/** Fork source for "retry this node", or null to hide the button — a live run, an unvisited node, the entry node, or a prefix that cannot be named (see retry-resume.ts). */
function useRetrySource(
  input: Pick<RunGraphInput, "nodes" | "runIsLive" | "selectedNodeId">,
) {
  const { nodes, runIsLive, selectedNodeId } = input;

  return useMemo(
    () =>
      runIsLive || selectedNodeId === null
        ? null
        : retryResumeSource(nodes, selectedNodeId),
    [runIsLive, nodes, selectedNodeId],
  );
}

type RunDataInput = Pick<
  RunGraphInput,
  "nodes" | "nodeStates" | "takenEdges" | "runStatus"
> & { latestRows: ReturnType<typeof latestRowByNode> };

/** The graph as the live rows describe it. */
function useRunData(input: RunDataInput): RunData {
  const { nodes, nodeStates, latestRows, takenEdges, runStatus } = input;

  return useMemo<RunData>(
    () =>
      buildRunData({ nodes, nodeStates, latestRows, takenEdges, runStatus }),
    [nodes, nodeStates, latestRows, takenEdges, runStatus],
  );
}

interface SelectedNodeInput {
  nodes: readonly AssemblyRunNode[];
  definition: AssemblyLineDefinition | null;
  reason: string | null;
  selectedNodeId: string | null;
  nodeStates: Readonly<Record<string, NodeRunState>>;
}

/** Everything the inspector needs about the selected node. Its walk rows are the source for the attempt history and the per-attempt pod logs; what each visit was GIVEN is per-visit state like its outcome, and rides those rows rather than the event stream, since no pod echoes its own prompt. */
export function useSelectedNode(input: SelectedNodeInput) {
  const { nodes, definition, reason, selectedNodeId, nodeStates } = input;
  const selected = pickSelectedState(nodeStates, selectedNodeId);
  const selectedRows = useMemo(
    () => nodes.filter((node) => node.nodeId === selectedNodeId),
    [nodes, selectedNodeId],
  );
  const nodeInputs = useNodeInputs(selectedRows);
  const selectedAttempts = useMemo(
    () => stepViews(definition, selectedRows, reason),
    [definition, selectedRows, reason],
  );
  const takenEdges = useMemo(
    () => takenEdgeKeys(definition, nodes),
    [definition, nodes],
  );

  return { selected, selectedRows, nodeInputs, selectedAttempts, takenEdges };
}

/** What each visit was GIVEN, per attempt. A visit with no recorded input contributes nothing rather than an empty entry — the inspector lists inputs, and a blank row reads as "given nothing" rather than "not recorded". */
function useNodeInputs(selectedRows: readonly AssemblyRunNode[]) {
  return useMemo(
    () =>
      selectedRows.flatMap((node) =>
        node.input ? [{ iteration: node.iteration, ...node.input }] : [],
      ),
    [selectedRows],
  );
}
