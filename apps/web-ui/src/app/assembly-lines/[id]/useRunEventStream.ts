"use client";

// IO shell: the EventSource lifecycle and nothing else. Every decision it acts
// on (the URL, the backoff, whether to connect at all) is computed in
// run-stream-presenter, which is where the tests for those live.

import { useEffect, useRef } from "react";
import {
  parseRunStreamEvent,
  type RunStreamEvent,
} from "@/lib/run-stream-types";
import type { ConnectionState } from "./run-stream-presenter";
import { reconnectDelayMs, streamUrl } from "./run-stream-presenter";

export interface RunEventStreamOptions {
  runId: string;
  afterId: string;
  enabled: boolean;
  onEvent: (event: RunStreamEvent) => void;
  onConnectionChange: (state: ConnectionState) => void;
}

/**
 * Subscribes to the SSE proxy while `enabled`. The browser reconnects on its own
 * and resends Last-Event-ID; the manual backoff here only covers the case where
 * the socket fails repeatedly and we want to stop hammering the proxy.
 *
 * Callbacks are held in refs so a caller passing inline closures — which is
 * every caller — does not tear the socket down and rebuild it on each render.
 */
export function useRunEventStream({
  runId,
  afterId,
  enabled,
  onEvent,
  onConnectionChange,
}: RunEventStreamOptions): void {
  const onEventRef = useRef(onEvent);
  const onConnectionChangeRef = useRef(onConnectionChange);
  // afterId changes on EVERY live event, so it must stay OUT of the socket
  // effect's deps: otherwise each event tore the EventSource down and rebuilt
  // it, which replayed, delivered events, and changed afterId again.
  const afterIdRef = useRef(afterId);

  // Declared before the socket effect so it has already run when that effect
  // fires. Refs may not be written during render (react-hooks/refs).
  useEffect(() => {
    onEventRef.current = onEvent;
    onConnectionChangeRef.current = onConnectionChange;
  });

  useEffect(() => {
    afterIdRef.current = afterId;
  }, [afterId]);

  useEffect(() => {
    if (!enabled || typeof EventSource === "undefined") {
      return;
    }

    let source: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let disposed = false;

    const handleMessage = (event: MessageEvent) => {
      const parsed = parseRunStreamEvent(String(event.data));

      if (parsed !== null) {
        onEventRef.current(parsed);
      }
    };

    const connect = () => {
      if (disposed) {
        return;
      }

      onConnectionChangeRef.current(
        attempt === 0 ? "connecting" : "reconnecting",
      );
      source = new EventSource(streamUrl(runId, afterIdRef.current));
      source.addEventListener("agent-event", handleMessage);
      source.addEventListener("catchup-complete", () => {
        attempt = 0;
        onConnectionChangeRef.current("live");
      });
      source.addEventListener("open", () => {
        attempt = 0;
        onConnectionChangeRef.current("live");
      });
      source.onerror = () => {
        source?.close();
        attempt += 1;
        onConnectionChangeRef.current("reconnecting");
        retryTimer = setTimeout(connect, reconnectDelayMs(attempt));
      };
    };

    connect();

    return () => {
      disposed = true;

      if (retryTimer !== null) {
        clearTimeout(retryTimer);
      }
      source?.close();
    };
  }, [runId, enabled]);
}
