"use client";

// IO shell: the EventSource lifecycle and nothing else — every decision (URL, backoff, whether to connect) is computed and tested in run-stream-presenter.
import { useEffect, useRef } from "react";
import {
  parseRunStreamEvent,
  type RunStreamEvent,
} from "@/lib/run-stream-types";
import type { ConnectionState } from "./run-stream-presenter";
import { reconnectAction, streamUrl } from "./run-stream-presenter";

export interface RunEventStreamOptions {
  runId: string;
  afterId: string;
  enabled: boolean;
  onEvent: (event: RunStreamEvent) => void;
  onConnectionChange: (state: ConnectionState) => void;
}

// Subscribes to the SSE proxy while `enabled`; manual backoff covers repeated failures. Callbacks live in refs so inline-closure callers don't rebuild the socket every render.
export function useRunEventStream({
  runId,
  afterId,
  enabled,
  onEvent,
  onConnectionChange,
}: RunEventStreamOptions): void {
  const onEventRef = useRef(onEvent);
  const onConnectionChangeRef = useRef(onConnectionChange);
  // afterId changes on EVERY live event, so it must stay OUT of the socket effect's deps or each event would tear down and rebuild the EventSource.
  const afterIdRef = useRef(afterId);

  // Declared before the socket effect so it has already run when that effect fires (refs may not be written during render).
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

        const action = reconnectAction(attempt);

        // Terminal for this session — no timer scheduled; the caller reacts to "offline" by dropping to history-only mode.
        if (action.kind === "give-up") {
          onConnectionChangeRef.current("offline");

          return;
        }

        onConnectionChangeRef.current("reconnecting");
        retryTimer = setTimeout(connect, action.delayMs);
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
