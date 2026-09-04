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

  // A terminal run renders state AS OF the scrub cursor by folding history through the SAME reducer live mode uses, based on the all-idle state (never the visit-row seed).
  const replayState = useMemo(
    () =>
      replayTo(
        initialRunState(definition, []),
        historyEvents,
        replayCursor ?? historyEvents.length,
      ),
    [definition, historyEvents, replayCursor],
  );
  const displayState = pickDisplayState(runIsLive, state, replayState);

  const scrubberVisible = computeScrubberVisible(
    runStatus,
    historyEvents.length,
  );
  const replayPosition = scrubberPositionLabel(
    historyEvents,
    replayCursor ?? historyEvents.length,
  );
  const onCursorChange = useCallback(
    (cursor: number) => setReplayCursor(cursor),
    [],
  );
  const onBackToLive = useCallback(() => setReplayCursor(null), []);
  const onSeek = useCallback(
    (id: string) => {
      const cursor = cursorForEventId(historyEvents, id);

      if (cursor !== null) {
        setReplayCursor(cursor);
      }
    },
    [historyEvents],
  );

  const selected = pickSelectedState(displayState.nodeStates, selectedNodeId);
  // The selected node's walk rows in execution order — the inspector's attempt history and per-attempt pod-log panel source.
  const selectedRows = useMemo(
    () => nodes.filter((node) => node.nodeId === selectedNodeId),
    [nodes, selectedNodeId],
  );
  // What each visit was GIVEN is per-visit STATE, like its outcome — rides the walk rows, not the event stream (no pod echoes its own prompt).
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

  const [showOutcomes, setShowOutcomes] = useState(false);
  const hasRunData = computeHasRunData(nodes.length, displayState.nodeStates);
  const graphMode = computeGraphMode(hasRunData, showOutcomes);
  const latestRows = useMemo(() => latestRowByNode(nodes), [nodes]);
  // Fork source for "retry this node" — null hides the button (live run, unvisited node, entry node, or an unnameable prefix; see retry-resume.ts).
  const retrySource = useMemo(
    () =>
      runIsLive || selectedNodeId === null
        ? null
        : retryResumeSource(nodes, selectedNodeId),
    [runIsLive, nodes, selectedNodeId],
  );
  const replayActive = computeReplayActive(
    runIsLive,
    replayCursor,
    historyEvents.length,
  );
  const runData = useMemo<RunData>(
    () =>
      replayActive
        ? // Mid-replay, walk rows are gated behind the replayed reducer state — a verdict shows only once the cursor applies that result event.
          replayRunData(definition, nodes, displayState.nodeStates)
        : buildRunData({
            nodes,
            nodeStates: displayState.nodeStates,
            latestRows,
            takenEdges,
            runStatus,
          }),
    [
      replayActive,
      definition,
      nodes,
      latestRows,
      displayState.nodeStates,
      takenEdges,
      runStatus,
    ],
  );
  const visibleGraph = useMemo(
    () =>
      deriveVisibleGraph(definition, hasRunData ? runData : null, graphMode),
    [definition, hasRunData, runData, graphMode],
  );

  return (
    <section className={styles.panel}>
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
        graph={visibleGraph}
        definition={definition}
        onSelectNode={setSelectedNodeId}
      />
      <OutcomesToggle
        show={hasRunData}
        showOutcomes={showOutcomes}
        onToggle={() => setShowOutcomes((s) => !s)}
      />
      <ReplayControlsSlot
        show={scrubberVisible}
        historyEventCount={historyEvents.length}
        replayCursor={replayCursor}
        position={replayPosition}
        onCursorChange={onCursorChange}
        onBackToLive={onBackToLive}
      />
      <SelectedNodeSection
        selectedNodeId={selectedNodeId}
        runId={runId}
        repo={repo}
        reason={reason}
        definition={definition}
        selectedState={selected}
        latestRows={latestRows}
        selectedRows={selectedRows}
        selectedAttempts={selectedAttempts}
        nodeInputs={nodeInputs}
        retrySource={retrySource}
        agentEditHrefs={agentEditHrefs}
        visibleNodeCount={visibleGraph.nodes.length}
      />
      <RunTimelineView
        ticks={displayState.timeline}
        runStartedAt={startedAt}
        now={now}
        onSeek={resolveOnSeek(scrubberVisible, onSeek)}
      />
      <FileHeatmapView
        touches={displayState.fileTouches}
        showAll={showAllFiles}
        onToggleShowAll={toggleShowAllFiles}
      />
    </section>
  );
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
