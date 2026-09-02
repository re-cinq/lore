"use client";

// The live-run container: it owns every piece of mutable state on this page and
// every side effect that produces one. RunGraphView below it stays a pure
// function of props (DDAU), which is what lore/no-io-in-view encodes — the
// Panel suffix is the sanctioned place for the IO that the View may not do.

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import type { AssemblyLineDefinition } from "@/lib/assembly-line-definition";
import type { AssemblyRunNode } from "@/lib/assembly-runs";
import {
  initialRunState,
  reduceRunEvent,
  replayTo,
} from "@/lib/run-event-reducer";
import { takenEdgeKeys } from "@/lib/run-taken-edges";
import { latestRowByNode, replayRunData } from "@/lib/run-replay-view";
import { deriveVisibleGraph, type RunData } from "@/lib/graph-view-model";
import { parseRunStreamRow, type RunStreamEvent } from "@/lib/run-stream-types";
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
  HISTORY_POLL_MS,
  connectionLabel,
  cursorForEventId,
  historyUrl,
  nextPageCursor,
  resolveChipState,
  resolveStreamMode,
  scrubberPositionLabel,
  isTerminalRunStatus,
  type ConnectionState,
} from "./run-stream-presenter";
import { useRunEventStream } from "./useRunEventStream";

export interface RunVisualizationPanelProps {
  runId: string;
  runStatus: string;
  startedAt: string | null;
  definition: AssemblyLineDefinition | null;
  nodes: readonly AssemblyRunNode[];
  repo: string;
  reason: string | null;
}

interface HistoryPage {
  events?: unknown[];
}

export default function RunVisualizationPanel({
  runId,
  runStatus,
  startedAt,
  definition,
  nodes,
  repo,
  reason,
}: RunVisualizationPanelProps) {
  // The timeline's right edge is `now`. A stalled node emits no events, so without
  // a clock it would freeze at the last tick and the stall would be invisible.
  // Tick once a second while the run is live; a terminal run stops emitting and
  // needs no moving edge.
  const runIsLive = !isTerminalRunStatus(runStatus);
  const [now, setNow] = useState(() => new Date().toISOString());

  useEffect(() => {
    if (!runIsLive) {
      return;
    }

    const id = setInterval(() => setNow(new Date().toISOString()), 1000);

    return () => clearInterval(id);
  }, [runIsLive]);

  const [state, dispatch] = useReducer(reduceRunEvent, undefined, () =>
    initialRunState(definition, nodes),
  );
  // The run history was folded FOR: comparing it to runId makes a stale gate
  // impossible by construction, where a boolean would need resetting.
  const [historyLoadedFor, setHistoryLoadedFor] = useState<string | null>(null);
  // The ordered persisted events, retained only to drive the replay scrubber on
  // a terminal run. A live run reads its state from the reducer and never scrubs.
  const [historyEvents, setHistoryEvents] = useState<RunStreamEvent[]>([]);
  // null = latest (the whole history / live end); a number = a scrub cursor.
  const [replayCursor, setReplayCursor] = useState<number | null>(null);
  const [streamUnavailable, setStreamUnavailable] = useState(false);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [showAllFiles, setShowAllFiles] = useState(false);

  // The history fold runs once per run and is the only promise this component
  // owns. A rejection degrades to the seeded graph plus an Offline chip rather
  // than an unhandled rejection or a blank page.
  useEffect(() => {
    let cancelled = false;

    async function foldHistory() {
      let cursor = "0";
      const collected: RunStreamEvent[] = [];

      try {
        for (;;) {
          const res = await fetch(historyUrl(runId, cursor), {
            signal: AbortSignal.timeout(15_000),
          });

          if (!res.ok) {
            if (!cancelled) {
              setStreamUnavailable(true);
              setConnection("offline");
            }

            return;
          }

          const body = (await res.json()) as HistoryPage;
          const rows = Array.isArray(body.events) ? body.events : [];

          if (cancelled) {
            return;
          }

          for (const row of rows) {
            const parsed = parseRunStreamRow(row);

            if (parsed !== null) {
              dispatch(parsed);
              collected.push(parsed);
            }
          }

          const next = nextPageCursor(
            rows.filter(
              (row): row is { id: string } =>
                typeof (row as { id?: unknown })?.id === "string",
            ),
          );

          if (next === null) {
            break;
          }
          cursor = next;
        }

        if (!cancelled) {
          setHistoryEvents(collected);
          setHistoryLoadedFor(runId);
        }
      } catch {
        if (!cancelled) {
          setConnection("offline");
        }
      }
    }

    void foldHistory();

    return () => {
      cancelled = true;
    };
  }, [runId]);

  const mode = resolveStreamMode({
    runStatus,
    eventSourceAvailable: typeof EventSource !== "undefined",
    streamUnavailable,
  });

  const onEvent = useCallback((event: RunStreamEvent) => dispatch(event), []);
  const toggleShowAllFiles = useCallback(
    () => setShowAllFiles((shown) => !shown),
    [],
  );
  // "offline" from the hook means it gave up for good (STREAM_MAX_ATTEMPTS
  // consecutive failures). Marking the stream unavailable flips the mode to
  // history-only, which disables the hook and hands the run to the poll below.
  const onConnectionChange = useCallback((next: ConnectionState) => {
    setConnection(next);

    if (next === "offline") {
      setStreamUnavailable(true);
    }
  }, []);

  useRunEventStream({
    runId,
    afterId: state.lastEventId ?? "0",
    enabled: mode === "live" && historyLoadedFor === runId,
    onEvent,
    onConnectionChange,
  });

  // The degraded path for a live run without a stream: poll the history proxy
  // from the reducer's own cursor. The cursor rides in a ref so a poll result
  // does not restart the interval, and the reducer's id de-duplication makes an
  // overlap with already-applied events a no-op.
  const lastEventIdRef = useRef(state.lastEventId ?? "0");

  useEffect(() => {
    lastEventIdRef.current = state.lastEventId ?? "0";
  }, [state.lastEventId]);

  const streamFallbackPollActive =
    runIsLive && mode === "history-only" && historyLoadedFor === runId;

  useEffect(() => {
    if (!streamFallbackPollActive) {
      return;
    }

    let cancelled = false;
    let inFlight = false;

    async function poll() {
      if (inFlight) {
        return;
      }

      inFlight = true;

      try {
        const res = await fetch(historyUrl(runId, lastEventIdRef.current), {
          signal: AbortSignal.timeout(15_000),
        });

        if (!res.ok || cancelled) {
          return;
        }

        const body = (await res.json()) as HistoryPage;
        const rows = Array.isArray(body.events) ? body.events : [];

        if (cancelled) {
          return;
        }

        for (const row of rows) {
          const parsed = parseRunStreamRow(row);

          if (parsed !== null) {
            dispatch(parsed);
          }
        }
      } catch {
        // The next tick retries; the chip already reads Polling.
      } finally {
        inFlight = false;
      }
    }

    const id = setInterval(() => void poll(), HISTORY_POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [streamFallbackPollActive, runId]);

  const chipState = resolveChipState({
    mode,
    connection,
    fallbackPollActive: streamFallbackPollActive,
  });

  // A terminal run renders the state AS OF the scrub cursor by folding the
  // persisted history through the SAME reducer live mode uses. The base is the
  // all-idle definition state, never the visit-row seed: rewinding a node to
  // idle is only possible when every status came from a replayed event. A live
  // run keeps its reducer state and shows no scrubber.
  const replayState = useMemo(
    () =>
      replayTo(
        initialRunState(definition, []),
        historyEvents,
        replayCursor ?? historyEvents.length,
      ),
    [definition, historyEvents, replayCursor],
  );
  const displayState = runIsLive ? state : replayState;

  const scrubberVisible =
    isTerminalRunStatus(runStatus) && historyEvents.length > 0;
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

  const selected =
    selectedNodeId === null ? null : displayState.nodeStates[selectedNodeId];
  // The selected node's walk rows in execution order — the inspector's attempt
  // history and the source of its per-attempt pod-log panels.
  const selectedRows = useMemo(
    () => nodes.filter((node) => node.nodeId === selectedNodeId),
    [nodes, selectedNodeId],
  );
  // What each visit was GIVEN is per-visit STATE, like its outcome — it rides the
  // walk rows, not the event stream, because no pod ever echoes its own prompt.
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

  // Run data exists once the walk has visited a node — via a persisted row or a
  // node that left idle on the live stream. Run mode is the default; "Show possible
  // outcomes" flips to the definition view without disturbing it.
  const participated = (s: {
    status: string;
    transcript: readonly unknown[];
  }): boolean => s.status !== "idle" || s.transcript.length > 0;
  const hasRunData =
    nodes.length > 0 ||
    Object.values(displayState.nodeStates).some(participated);
  const [showOutcomes, setShowOutcomes] = useState(false);
  const graphMode = hasRunData && !showOutcomes ? "run" : "definition";
  const latestRows = useMemo(() => latestRowByNode(nodes), [nodes]);
  // The fork source for "retry this node" — null hides the button: a live run,
  // an unvisited node, the entry node, or a prefix the fork API cannot name
  // exactly (see retry-resume.ts).
  const retrySource = useMemo(
    () =>
      runIsLive || selectedNodeId === null
        ? null
        : retryResumeSource(nodes, selectedNodeId),
    [runIsLive, nodes, selectedNodeId],
  );
  // Mid-scrub only: the cursor sits strictly before the history's end, so the
  // slider's right end stays byte-identical to Back to live — nodes with walk
  // rows but no events (a `done` terminal) keep their verdict at max cursor.
  const replayActive =
    !runIsLive && replayCursor !== null && replayCursor < historyEvents.length;
  const runData = useMemo<RunData>(() => {
    // Mid-replay, the walk rows are gated behind the replayed reducer state: a
    // recorded verdict shows only once the cursor has applied that
    // node-iteration's result event, and the taken path grows with the cursor.
    if (replayActive) {
      return replayRunData(definition, nodes, displayState.nodeStates);
    }

    const entries = Object.entries(displayState.nodeStates);
    // The verdict is the walk row's recorded outcome, latest iteration per node.
    // It must come from the rows, not the reducer state: a replayed terminal run
    // seeds its node states from events, which never carry the verdict, so a
    // review that exited its pod cleanly with a failed verdict would otherwise
    // read from its "succeeded" execution status instead of "failed".
    const rows = [...latestRows.values()];
    // The run failed if any node's recorded outcome failed — mirrors the Floor's
    // lineOutcomeFromVisits, so a code-review line that closes `finished` with a
    // failed review still reports the run result as failed on its terminal.
    const anyFailed = rows.some((n) => (n.outcome ?? "").includes("failed"));

    return {
      // A node participated once it left idle (live stream) or has a walk row.
      executed: new Set([
        ...nodes.map((n) => n.nodeId),
        ...entries.filter(([, s]) => participated(s)).map(([id]) => id),
      ]),
      verdicts: Object.fromEntries(rows.map((n) => [n.nodeId, n.outcome])),
      statuses: Object.fromEntries(entries.map(([id, s]) => [id, s.status])),
      taken: takenEdges,
      result: anyFailed
        ? "failed"
        : isTerminalRunStatus(runStatus)
          ? "completed"
          : null,
    };
  }, [
    replayActive,
    definition,
    nodes,
    latestRows,
    displayState.nodeStates,
    takenEdges,
    runStatus,
  ]);
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
      {hasRunData ? (
        <button
          type="button"
          className={styles.outcomesToggle}
          aria-pressed={showOutcomes}
          onClick={() => setShowOutcomes((s) => !s)}
        >
          {showOutcomes ? "Show executed path" : "Show possible outcomes"}
        </button>
      ) : null}
      {scrubberVisible ? (
        <div className={styles.replayControls}>
          <ReplayScrubberView
            eventCount={historyEvents.length}
            cursor={replayCursor ?? historyEvents.length}
            label={replayPosition.label}
            timestamp={replayPosition.timestamp}
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
      ) : null}
      {selectedNodeId ? (
        <section
          className={styles.inspector}
          aria-label={`${selectedNodeId} inspector`}
        >
          <RunNodeDetail
            nodeId={selectedNodeId}
            state={selected ?? undefined}
            row={latestRows.get(selectedNodeId)}
            definition={definition}
            reason={reason}
            repo={repo}
            attempts={selectedAttempts}
            actions={
              retrySource !== null ? (
                <RerunNodeButton
                  runId={runId}
                  resumeNodeId={retrySource.nodeId}
                  resumeIteration={retrySource.iteration}
                />
              ) : undefined
            }
          />
          <NodeInputCard inputs={nodeInputs} />
          {selectedRows
            .filter((row) => row.agentCrName)
            .map((row) => (
              <NodeLogPanel
                key={row.agentCrName as string}
                assemblyLineId={runId}
                agentCrName={row.agentCrName as string}
                label={`Pod logs · attempt ${row.iteration}`}
              />
            ))}
        </section>
      ) : null}
      {!selectedNodeId && visibleGraph.nodes.length > 0 ? (
        <p className={styles.hint}>
          Select a node in the graph to inspect its detail, transcript, and pod
          logs.
        </p>
      ) : null}
      {!selectedNodeId && visibleGraph.nodes.length === 0 ? (
        <p className={styles.hint}>No node executions recorded.</p>
      ) : null}
      {selectedNodeId ? (
        // Keyed on the run for the same reason historyLoadedFor compares to
        // runId above: a run change must reset the loaded transcript by
        // construction, not by a flag someone has to remember to clear.
        <FullTranscriptPanel
          key={runId}
          runId={runId}
          nodeId={selectedNodeId}
        />
      ) : null}
      <RunTimelineView
        ticks={displayState.timeline}
        runStartedAt={startedAt}
        now={now}
        onSeek={scrubberVisible ? onSeek : undefined}
      />
      <FileHeatmapView
        touches={displayState.fileTouches}
        showAll={showAllFiles}
        onToggleShowAll={toggleShowAllFiles}
      />
    </section>
  );
}
