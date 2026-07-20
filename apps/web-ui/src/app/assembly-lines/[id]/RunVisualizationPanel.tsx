"use client";

// The live-run container: it owns every piece of mutable state on this page and
// every side effect that produces one. RunGraphView below it stays a pure
// function of props (DDAU), which is what lore/no-io-in-view encodes — the
// Panel suffix is the sanctioned place for the IO that the View may not do.

import { useCallback, useEffect, useReducer, useState } from "react";
import type { AssemblyLineDefinition } from "@/lib/assembly-line-definition";
import type { AssemblyLineRunNode } from "@/lib/assembly-line-runs";
import { initialRunState, reduceRunEvent } from "@/lib/run-event-reducer";
import { parseRunStreamRow, type RunStreamEvent } from "@/lib/run-stream-types";
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
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [streamUnavailable, setStreamUnavailable] = useState(false);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

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
          setHistoryLoaded(true);
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
    enabled: mode === "live" && historyLoaded,
    onEvent,
    onConnectionChange: setConnection,
  });

  const chipState: ConnectionState =
    mode === "history-only" && connection !== "offline"
      ? "offline"
      : connection;
  const selected =
    selectedNodeId === null ? null : state.nodeStates[selectedNodeId];

  return (
    <section className={styles.panel}>
      <div className={styles.header}>
        <span className={`${styles.chip} ${styles[chipState]}`}>
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
        <p className={styles.selected}>
          {selectedNodeId} — {selected.status}, iteration {selected.iteration},{" "}
          {selected.transcript.length} events
        </p>
      ) : null}
    </section>
  );
}
