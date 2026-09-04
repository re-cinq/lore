"use client";

// The live-run container: owns every piece of mutable state and IO here so RunGraphView below stays a pure function of props (DDAU / lore/no-io-in-view).
import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import Link from "next/link";
import type { AssemblyLineDefinition } from "@/lib/assembly-line-definition";
import type { AssemblyRunNode } from "@/lib/assembly-runs";
import {
  initialRunState,
  reduceRunEvent,
  replayTo,
  type NodeRunState,
} from "@/lib/run-event-reducer";
import { takenEdgeKeys } from "@/lib/run-taken-edges";
import { latestRowByNode, replayRunData } from "@/lib/run-replay-view";
import { deriveVisibleGraph, type RunData } from "@/lib/graph-view-model";
import type { RunStreamEvent } from "@/lib/run-stream-types";
import { stepViews } from "@/lib/step-presenter";
import FileHeatmapView from "./FileHeatmapView";
import FullTranscriptPanel from "./FullTranscriptPanel";
import NodeLogPanel from "./NodeLogPanel";
import ReplayScrubberView from "./ReplayScrubberView";
import RunGraphView from "./RunGraphView";
import NodeInputCard from "./NodeInputCard";
import RunNodeDetail from "./RunNodeDetail";
import RunTimelineView from "./RunTimelineView";
import { RerunNodeButton } from "./RerunNodeButton";
import { retryResumeSource } from "./retry-resume";
import styles from "./RunVisualizationPanel.module.css";
import {
  connectionLabel,
  cursorForEventId,
  scrubberPositionLabel,
  isTerminalRunStatus,
} from "./run-stream-presenter";
import { useRunStream } from "./use-run-history";

export interface RunVisualizationPanelProps {
  runId: string;
  runStatus: string;
  startedAt: string | null;
  definition: AssemblyLineDefinition | null;
  nodes: readonly AssemblyRunNode[];
  repo: string;
  reason: string | null;
  // nodeId → agents-editor href for each agent node the catalog holds; resolved server-side, the panel only renders what it is handed.
  agentEditHrefs?: Record<string, string>;
}

/** The timeline's right edge is `now` — without a clock a stalled node's last tick would look identical to a live one. Ticks once a second while the run is live. */
function useNowTicker(live: boolean): string {
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

/** Run data exists once the walk visited a node (persisted row or left-idle live stream); "Show possible outcomes" flips to definition view without disturbing it. */
function participated(state: NodeRunState): boolean {
  return state.status !== "idle" || state.transcript.length > 0;
}

/** A run reports failed the moment any node did, and completed only once it is terminal with none — an unfinished run has no result yet. */
function runResult(anyFailed: boolean, runStatus: string): RunData["result"] {
  if (anyFailed) {
    return "failed";
  }

  return isTerminalRunStatus(runStatus) ? "completed" : null;
}

/** The selected node's current run state, or null when nothing is selected — mirrors the object-index lookup Object[key] would give. */
function pickSelectedState(
  nodeStates: Readonly<Record<string, NodeRunState>>,
  selectedNodeId: string | null,
): NodeRunState | null {
  return selectedNodeId === null ? null : nodeStates[selectedNodeId];
}

/** Which of the two reducer states (live vs. scrubbed-back-in-time) the panel currently shows. */
function pickDisplayState(
  runIsLive: boolean,
  state: ReturnType<typeof initialRunState>,
  replayState: ReturnType<typeof initialRunState>,
) {
  return runIsLive ? state : replayState;
}

/** The scrubber only makes sense once a run is over and actually has history to scrub through. */
function computeScrubberVisible(
  runStatus: string,
  historyEventCount: number,
): boolean {
  return isTerminalRunStatus(runStatus) && historyEventCount > 0;
}

/** True once the walk has visited something worth showing — either persisted rows or a live-but-idle stream. */
function computeHasRunData(
  nodeCount: number,
  nodeStates: Readonly<Record<string, NodeRunState>>,
): boolean {
  return nodeCount > 0 || Object.values(nodeStates).some(participated);
}

/** "run" shows only the executed path; toggling to outcomes (or having nothing executed yet) falls back to "definition". */
function computeGraphMode(
  hasRunData: boolean,
  showOutcomes: boolean,
): "run" | "definition" {
  return hasRunData && !showOutcomes ? "run" : "definition";
}

/** Mid-scrub only — the cursor sits strictly before the history's end, so the slider's right end stays byte-identical to Back to live. */
function computeReplayActive(
  runIsLive: boolean,
  replayCursor: number | null,
  historyEventCount: number,
): boolean {
  return (
    !runIsLive && replayCursor !== null && replayCursor < historyEventCount
  );
}

/** Only wire onSeek through once the scrubber is actually visible — an invisible scrubber has nothing to seek. */
function resolveOnSeek(
  scrubberVisible: boolean,
  onSeek: (id: string) => void,
): ((id: string) => void) | undefined {
  return scrubberVisible ? onSeek : undefined;
}

/** "Show possible outcomes" only makes sense once there is an executed path to toggle away from. */
function OutcomesToggle({
  show,
  showOutcomes,
  onToggle,
}: {
  show: boolean;
  showOutcomes: boolean;
  onToggle: () => void;
}) {
  if (!show) {
    return null;
  }

  return (
    <button
      type="button"
      className={styles.outcomesToggle}
      aria-pressed={showOutcomes}
      onClick={onToggle}
    >
      {showOutcomes ? "Show executed path" : "Show possible outcomes"}
    </button>
  );
}

/** The replay scrubber, shown only once a finished run has history to scrub through. */
function ReplayControlsSlot({
  show,
  historyEventCount,
  replayCursor,
  position,
  onCursorChange,
  onBackToLive,
}: {
  show: boolean;
  historyEventCount: number;
  replayCursor: number | null;
  position: { label: string; timestamp: string | null };
  onCursorChange: (cursor: number) => void;
  onBackToLive: () => void;
}) {
  if (!show) {
    return null;
  }

  return (
    <ReplayControls
      eventCount={historyEventCount}
      cursor={replayCursor ?? historyEventCount}
      position={position}
      onCursorChange={onCursorChange}
      onBackToLive={onBackToLive}
    />
  );
}

/** Everything shown about the currently selected node — or the hint to pick one when nothing is selected. */
function SelectedNodeSection({
  selectedNodeId,
  runId,
  repo,
  reason,
  definition,
  selectedState,
  latestRows,
  selectedRows,
  selectedAttempts,
  nodeInputs,
  retrySource,
  agentEditHrefs,
  visibleNodeCount,
}: {
  selectedNodeId: string | null;
  runId: string;
  repo: string;
  reason: string | null;
  definition: AssemblyLineDefinition | null;
  selectedState: NodeRunState | null;
  latestRows: Map<string, AssemblyRunNode>;
  selectedRows: readonly AssemblyRunNode[];
  selectedAttempts: Parameters<typeof RunNodeDetail>[0]["attempts"];
  nodeInputs: Parameters<typeof NodeInputCard>[0]["inputs"];
  retrySource: { nodeId: string; iteration: number } | null;
  agentEditHrefs?: Record<string, string>;
  visibleNodeCount: number;
}) {
  if (selectedNodeId === null) {
    return <SelectionHint nodeCount={visibleNodeCount} />;
  }

  return (
    <>
      <NodeInspector
        nodeId={selectedNodeId}
        runId={runId}
        repo={repo}
        reason={reason}
        definition={definition}
        state={selectedState ?? undefined}
        row={latestRows.get(selectedNodeId)}
        rows={selectedRows}
        attempts={selectedAttempts}
        inputs={nodeInputs}
        retrySource={retrySource}
        agentEditHref={agentEditHrefs?.[selectedNodeId]}
      />
      {/* Keyed on the run so a run change resets the loaded transcript by construction, not by a flag someone has to remember to clear. */}
      <FullTranscriptPanel key={runId} runId={runId} nodeId={selectedNodeId} />
    </>
  );
}

/** The graph's view of a live or finished run: which nodes ran, what each was told, and whether the run as a whole succeeded. */
function buildRunData({
  nodes,
  nodeStates,
  latestRows,
  takenEdges,
  runStatus,
}: {
  nodes: readonly AssemblyRunNode[];
  nodeStates: Readonly<Record<string, NodeRunState>>;
  latestRows: Map<string, AssemblyRunNode>;
  takenEdges: RunData["taken"];
  runStatus: string;
}): RunData {
  const entries = Object.entries(nodeStates);
  // Verdict is the walk row's recorded outcome (must come from rows, not reducer state — replayed events never carry the verdict).
  const rows = [...latestRows.values()];
  // Mirrors the Floor's lineOutcomeFromVisits: any failed node outcome fails the run result, even on a `finished` terminal.
  const anyFailed = rows.some((n) => (n.outcome ?? "").includes("failed"));

  return {
    executed: new Set([
      ...nodes.map((n) => n.nodeId),
      ...entries.filter(([, s]) => participated(s)).map(([id]) => id),
    ]),
    verdicts: Object.fromEntries(rows.map((n) => [n.nodeId, n.outcome])),
    statuses: Object.fromEntries(entries.map(([id, s]) => [id, s.status])),
    taken: takenEdges,
    result: runResult(anyFailed, runStatus),
  };
}

export default function RunVisualizationPanel({
  runId,
  runStatus,
  startedAt,
  definition,
  nodes,
  repo,
  reason,
  agentEditHrefs,
}: RunVisualizationPanelProps) {
  const runIsLive = !isTerminalRunStatus(runStatus);
  // The five values every derivation below needs; named once so each hook takes what it adds.
  const run = { nodes, definition, runStatus, runIsLive, reason };
  const now = useNowTicker(runIsLive);
  const [state, dispatch] = useReducer(reduceRunEvent, undefined, () =>
    initialRunState(definition, nodes),
  );
  const [replayCursor, setReplayCursor] = useState<number | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [showAllFiles, setShowAllFiles] = useState(false);
  const onEvent = useCallback((event: RunStreamEvent) => dispatch(event), []);
  const { historyEvents, chipState } = useRunStream({
    runId,
    runStatus,
    runIsLive,
    lastEventId: state.lastEventId ?? "0",
    dispatch: onEvent,
  });
  const toggleShowAllFiles = useCallback(
    () => setShowAllFiles((shown) => !shown),
    [],
  );

  const replay = useReplay({
    ...run,
    historyEvents,
    liveState: state,
    replayCursor,
    setReplayCursor,
  });
  const { displayState, scrubberVisible, replayPosition, replayActive } =
    replay;
  const node = useSelectedNode({
    ...run,
    selectedNodeId,
    nodeStates: displayState.nodeStates,
  });
  const [showOutcomes, setShowOutcomes] = useState(false);
  const graph = useRunGraph({
    ...run,
    selectedNodeId,
    showOutcomes,
    replayActive,
    nodeStates: displayState.nodeStates,
    takenEdges: node.takenEdges,
  });

  return (
    <section className={styles.panel}>
      <RunGraphSection
        chipState={chipState}
        graph={graph.visibleGraph}
        definition={definition}
        onSelectNode={setSelectedNodeId}
        hasRunData={graph.hasRunData}
        showOutcomes={showOutcomes}
        onToggleOutcomes={() => setShowOutcomes((shown) => !shown)}
        replay={{
          show: scrubberVisible,
          historyEventCount: historyEvents.length,
          cursor: replayCursor,
          position: replayPosition,
          onCursorChange: replay.onCursorChange,
          onBackToLive: replay.onBackToLive,
        }}
      />
      <RunDetailSection
        {...{
          selectedNodeId,
          runId,
          repo,
          reason,
          definition,
          latestRows: graph.latestRows,
          selectedRows: node.selectedRows,
          selectedAttempts: node.selectedAttempts,
          nodeInputs: node.nodeInputs,
          retrySource: graph.retrySource,
          agentEditHrefs,
          startedAt,
          now,
          showAllFiles,
          toggleShowAllFiles,
        }}
        selectedState={node.selected}
        visibleNodeCount={graph.visibleGraph.nodes.length}
        timeline={displayState.timeline}
        fileTouches={displayState.fileTouches}
        onSeek={resolveOnSeek(scrubberVisible, replay.onSeek)}
      />
    </section>
  );
}

/** Everything below the graph: the selected node's inspector, the timeline, and the file heatmap. */
function RunDetailSection({
  timeline,
  fileTouches,
  startedAt,
  now,
  onSeek,
  showAllFiles,
  toggleShowAllFiles,
  ...inspector
}: Parameters<typeof SelectedNodeSection>[0] & {
  timeline: ReturnType<typeof initialRunState>["timeline"];
  fileTouches: ReturnType<typeof initialRunState>["fileTouches"];
  startedAt: string | null;
  now: string;
  onSeek: ((id: string) => void) | undefined;
  showAllFiles: boolean;
  toggleShowAllFiles: () => void;
}) {
  return (
    <>
      <SelectedNodeSection {...inspector} />
      <RunTimelineView
        ticks={timeline}
        runStartedAt={startedAt}
        now={now}
        onSeek={onSeek}
      />
      <FileHeatmapView
        touches={fileTouches}
        showAll={showAllFiles}
        onToggleShowAll={toggleShowAllFiles}
      />
    </>
  );
}

/** The run as a picture: the connection chip, the graph itself, the definition/run toggle, and the scrubber for a finished run. */
function RunGraphSection({
  chipState,
  graph,
  definition,
  onSelectNode,
  hasRunData,
  showOutcomes,
  onToggleOutcomes,
  replay,
}: {
  chipState: Parameters<typeof connectionLabel>[0];
  graph: Parameters<typeof RunGraphView>[0]["graph"];
  definition: AssemblyLineDefinition | null;
  onSelectNode: (nodeId: string) => void;
  hasRunData: boolean;
  showOutcomes: boolean;
  onToggleOutcomes: () => void;
  replay: {
    show: boolean;
    historyEventCount: number;
    cursor: number | null;
    position: { label: string; timestamp: string | null };
    onCursorChange: (cursor: number) => void;
    onBackToLive: () => void;
  };
}) {
  return (
    <>
      <div className={styles.header}>
        <span
          className={`${styles.chip} ${styles[chipState]}`}
          role="status"
          aria-live="polite"
        >
          {connectionLabel(chipState)}
        </span>
      </div>
      <RunGraphView
        graph={graph}
        definition={definition}
        onSelectNode={onSelectNode}
      />
      <OutcomesToggle
        show={hasRunData}
        showOutcomes={showOutcomes}
        onToggle={onToggleOutcomes}
      />
      <ReplayControlsSlot
        show={replay.show}
        historyEventCount={replay.historyEventCount}
        replayCursor={replay.cursor}
        position={replay.position}
        onCursorChange={replay.onCursorChange}
        onBackToLive={replay.onBackToLive}
      />
    </>
  );
}

/** The graph the page draws: which nodes ran, what each was told, and — while scrubbing — the replayed view instead, since a verdict must not show before the cursor reaches the event that produced it. */
function useRunGraph({
  nodes,
  definition,
  runStatus,
  runIsLive,
  selectedNodeId,
  showOutcomes,
  replayActive,
  nodeStates,
  takenEdges,
}: {
  nodes: readonly AssemblyRunNode[];
  definition: AssemblyLineDefinition | null;
  runStatus: string;
  runIsLive: boolean;
  selectedNodeId: string | null;
  showOutcomes: boolean;
  replayActive: boolean;
  nodeStates: Readonly<Record<string, NodeRunState>>;
  takenEdges: RunData["taken"];
}) {
  const hasRunData = computeHasRunData(nodes.length, nodeStates);
  const latestRows = useMemo(() => latestRowByNode(nodes), [nodes]);
  // Fork source for "retry this node" — null hides the button (live run, unvisited node, entry node, or an unnameable prefix; see retry-resume.ts).
  const retrySource = useMemo(
    () =>
      runIsLive || selectedNodeId === null
        ? null
        : retryResumeSource(nodes, selectedNodeId),
    [runIsLive, nodes, selectedNodeId],
  );
  const runData = useMemo<RunData>(
    () =>
      replayActive
        ? replayRunData(definition, nodes, nodeStates)
        : buildRunData({
            nodes,
            nodeStates,
            latestRows,
            takenEdges,
            runStatus,
          }),
    [
      replayActive,
      definition,
      nodes,
      latestRows,
      nodeStates,
      takenEdges,
      runStatus,
    ],
  );
  const graphMode = computeGraphMode(hasRunData, showOutcomes);
  const visibleGraph = useMemo(
    () =>
      deriveVisibleGraph(definition, hasRunData ? runData : null, graphMode),
    [definition, hasRunData, runData, graphMode],
  );

  return { hasRunData, visibleGraph, retrySource, latestRows };
}

/** Scrubbing a finished run. A terminal run renders state AS OF the cursor by folding history through the SAME reducer live mode uses, based on the all-idle state — never the visit-row seed, which would show verdicts the cursor has not reached. */
function useReplay({
  runIsLive,
  runStatus,
  definition,
  historyEvents,
  liveState,
  replayCursor,
  setReplayCursor,
}: {
  runIsLive: boolean;
  runStatus: string;
  definition: AssemblyLineDefinition | null;
  historyEvents: RunStreamEvent[];
  liveState: ReturnType<typeof initialRunState>;
  replayCursor: number | null;
  setReplayCursor: (cursor: number | null) => void;
}) {
  const replayState = useMemo(
    () =>
      replayTo(
        initialRunState(definition, []),
        historyEvents,
        replayCursor ?? historyEvents.length,
      ),
    [definition, historyEvents, replayCursor],
  );
  const onSeek = useCallback(
    (id: string) => {
      const cursor = cursorForEventId(historyEvents, id);

      if (cursor !== null) {
        setReplayCursor(cursor);
      }
    },
    [historyEvents, setReplayCursor],
  );

  return {
    displayState: pickDisplayState(runIsLive, liveState, replayState),
    scrubberVisible: computeScrubberVisible(runStatus, historyEvents.length),
    replayPosition: scrubberPositionLabel(
      historyEvents,
      replayCursor ?? historyEvents.length,
    ),
    replayActive: computeReplayActive(
      runIsLive,
      replayCursor,
      historyEvents.length,
    ),
    onCursorChange: setReplayCursor,
    onBackToLive: () => setReplayCursor(null),
    onSeek,
  };
}

/** Everything the inspector needs about the selected node. Its walk rows are the source for the attempt history and the per-attempt pod logs; what each visit was GIVEN is per-visit state like its outcome, and rides those rows rather than the event stream, since no pod echoes its own prompt. */
function useSelectedNode({
  nodes,
  definition,
  reason,
  selectedNodeId,
  nodeStates,
}: {
  nodes: readonly AssemblyRunNode[];
  definition: AssemblyLineDefinition | null;
  reason: string | null;
  selectedNodeId: string | null;
  nodeStates: Readonly<Record<string, NodeRunState>>;
}) {
  const selected = pickSelectedState(nodeStates, selectedNodeId);
  const selectedRows = useMemo(
    () => nodes.filter((node) => node.nodeId === selectedNodeId),
    [nodes, selectedNodeId],
  );
  const nodeInputs = useMemo(
    () =>
      selectedRows.flatMap((node) =>
        node.input ? [{ iteration: node.iteration, ...node.input }] : [],
      ),
    [selectedRows],
  );
  const selectedAttempts = useMemo(
    () => stepViews(definition, selectedRows, reason),
    [definition, selectedRows, reason],
  );
  const takenEdges = useMemo(
    () => takenEdgeKeys(definition, nodes),
    [definition, nodes],
  );

  return {
    selected,
    selectedRows,
    nodeInputs,
    selectedAttempts,
    takenEdges,
  };
}

/** Everything the panel shows about ONE selected node: its detail card, what the visit was given, and a pod-log panel per attempt that produced a CR. */
function NodeInspector({
  nodeId,
  runId,
  repo,
  reason,
  definition,
  state,
  row,
  rows,
  attempts,
  inputs,
  retrySource,
  agentEditHref,
}: {
  nodeId: string;
  runId: string;
  repo: string;
  reason: string | null;
  definition: AssemblyLineDefinition | null;
  state: Parameters<typeof RunNodeDetail>[0]["state"];
  row: Parameters<typeof RunNodeDetail>[0]["row"];
  rows: readonly AssemblyRunNode[];
  attempts: Parameters<typeof RunNodeDetail>[0]["attempts"];
  inputs: Parameters<typeof NodeInputCard>[0]["inputs"];
  retrySource: { nodeId: string; iteration: number } | null;
  agentEditHref?: string;
}) {
  const actions =
    retrySource !== null || agentEditHref !== undefined ? (
      <>
        {agentEditHref !== undefined ? (
          // Inside a <summary>: without stopPropagation the card would also toggle shut behind the navigation.
          <Link
            className="btn-secondary"
            href={agentEditHref}
            onClick={(event) => event.stopPropagation()}
          >
            Edit agent
          </Link>
        ) : null}
        {retrySource !== null ? (
          <RerunNodeButton
            runId={runId}
            resumeNodeId={retrySource.nodeId}
            resumeIteration={retrySource.iteration}
          />
        ) : null}
      </>
    ) : undefined;

  return (
    <section className={styles.inspector} aria-label={`${nodeId} inspector`}>
      <RunNodeDetail
        nodeId={nodeId}
        state={state}
        row={row}
        definition={definition}
        reason={reason}
        repo={repo}
        attempts={attempts}
        actions={actions}
      />
      <NodeInputCard inputs={inputs} />
      {rows
        .filter((attempt) => attempt.agentCrName)
        .map((attempt) => (
          <NodeLogPanel
            key={attempt.agentCrName as string}
            assemblyLineId={runId}
            agentCrName={attempt.agentCrName as string}
            label={`Pod logs · attempt ${attempt.iteration}`}
          />
        ))}
    </section>
  );
}

/** Scrub back through a finished run's events, and the way back to its end. */
function ReplayControls({
  eventCount,
  cursor,
  position,
  onCursorChange,
  onBackToLive,
}: {
  eventCount: number;
  cursor: number;
  position: { label: string; timestamp: string | null };
  onCursorChange: (cursor: number) => void;
  onBackToLive: () => void;
}) {
  return (
    <div className={styles.replayControls}>
      <ReplayScrubberView
        eventCount={eventCount}
        cursor={cursor}
        label={position.label}
        timestamp={position.timestamp}
        onCursorChange={onCursorChange}
      />
      <button
        type="button"
        className={styles.backToLive}
        onClick={onBackToLive}
      >
        Back to live
      </button>
    </div>
  );
}

/** What to say when nothing is selected: how to inspect a node, or that there is nothing to inspect. */
function SelectionHint({ nodeCount }: { nodeCount: number }) {
  return (
    <p className={styles.hint}>
      {nodeCount > 0
        ? "Select a node in the graph to inspect its detail, transcript, and pod logs."
        : "No node executions recorded."}
    </p>
  );
}
