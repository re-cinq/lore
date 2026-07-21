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
import type { AssemblyLineRunNode } from "@/lib/assembly-line-runs";
import { initialRunState, reduceRunEvent } from "@/lib/run-event-reducer";
import { parseRunStreamRow, type RunStreamEvent } from "@/lib/run-stream-types";
import { toTranscriptRows } from "@/lib/transcript-rows";
import NodeTranscriptView, {
  recallScroll,
  rememberScroll,
  shouldFollowTail,
} from "./NodeTranscriptView";
import RunGraphView from "./RunGraphView";
import styles from "./RunVisualizationPanel.module.css";
import {
  connectionLabel,
  historyUrl,
  nextPageCursor,
  resolveStreamMode,
  type ConnectionState,
} from "./run-stream-presenter";
import { useRunEventStream } from "./useRunEventStream";

export interface RunVisualizationPanelProps {
  runId: string;
  runStatus: string;
  definition: AssemblyLineDefinition | null;
  showEdgeLabels: boolean;
  nodes: readonly AssemblyLineRunNode[];
}

interface HistoryPage {
  events?: unknown[];
}

export default function RunVisualizationPanel({
  runId,
  runStatus,
  definition,
  showEdgeLabels,
  nodes,
}: RunVisualizationPanelProps) {
  const [state, dispatch] = useReducer(reduceRunEvent, undefined, () =>
    initialRunState(definition, nodes),
  );
  // The run history was folded FOR: comparing it to runId makes a stale gate
  // impossible by construction, where a boolean would need resetting.
  const [historyLoadedFor, setHistoryLoadedFor] = useState<string | null>(null);
  const [streamUnavailable, setStreamUnavailable] = useState(false);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Refs, not state: neither the remembered offsets nor the follow flag may
  // trigger a render — a scroll handler that re-rendered the transcript on every
  // wheel tick would be its own performance bug.
  const offsetsRef = useRef<Record<string, number>>({});
  const followTailRef = useRef(true);

  // The history fold runs once per run and is the only promise this component
  // owns. A rejection degrades to the seeded graph plus an Offline chip rather
  // than an unhandled rejection or a blank page.
  useEffect(() => {
    let cancelled = false;

    async function foldHistory() {
      let cursor = "0";

      try {
        for (;;) {
          const res = await fetch(historyUrl(runId, cursor));

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

  useRunEventStream({
    runId,
    afterId: state.lastEventId ?? "0",
    enabled: mode === "live" && historyLoadedFor === runId,
    onEvent,
    onConnectionChange: setConnection,
  });

  const chipState: ConnectionState =
    mode === "history-only" && connection !== "offline"
      ? "offline"
      : connection;
  const selected =
    selectedNodeId === null ? null : state.nodeStates[selectedNodeId];
  const rows = useMemo(
    () => (selected ? toTranscriptRows(selected.transcript) : []),
    [selected],
  );

  const onTranscriptScroll = useCallback(() => {
    const box = scrollRef.current;

    if (box === null) {
      return;
    }

    followTailRef.current = shouldFollowTail(
      box.scrollTop,
      box.scrollHeight,
      box.clientHeight,
    );

    if (selectedNodeId !== null) {
      offsetsRef.current = rememberScroll(
        offsetsRef.current,
        selectedNodeId,
        box.scrollTop,
      );
    }
  }, [selectedNodeId]);

  // Selection change restores where this node was left, so switching away and
  // back does not silently reset the reader to the top.
  useEffect(() => {
    const box = scrollRef.current;

    if (box === null || selectedNodeId === null) {
      return;
    }

    box.scrollTop = recallScroll(offsetsRef.current, selectedNodeId);
    followTailRef.current = shouldFollowTail(
      box.scrollTop,
      box.scrollHeight,
      box.clientHeight,
    );
  }, [selectedNodeId]);

  // New rows follow the tail only for a reader already at the bottom.
  useEffect(() => {
    const box = scrollRef.current;

    if (box !== null && followTailRef.current) {
      box.scrollTop = box.scrollHeight;
    }
  }, [rows]);

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
        definition={definition}
        nodeStates={state.nodeStates}
        showEdgeLabels={showEdgeLabels}
        onSelectNode={setSelectedNodeId}
      />
      {selected && selectedNodeId ? (
        <div
          className={styles.transcriptScroll}
          ref={scrollRef}
          onScroll={onTranscriptScroll}
        >
          <NodeTranscriptView
            nodeId={selectedNodeId}
            rows={rows}
            droppedCount={selected.droppedCount}
          />
        </div>
      ) : null}
    </section>
  );
}
