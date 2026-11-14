"use client";

// A run's channel on the tab's live socket, opened on the person's session with no token of its own: opened while `enabled`, closed on unmount, resumed from the newest event seen. Every decision (backoff, re-open) is the socket client's; this hook only binds a page's callbacks to one channel.
import { useEffect, useRef } from "react";
import { useLiveSocket } from "@/lib/live-socket/LiveSocketProvider";
import type { RunStreamFrame } from "@/lib/run-stream-types";
import type { ConnectionState } from "@/lib/run-stream-presenter";

export interface RunChannelOptions {
  runId: string;
  afterId: string;
  enabled: boolean;
  onFrame: (frame: RunStreamFrame) => void;
  onConnectionChange: (state: ConnectionState) => void;
}

export function useRunChannel(options: RunChannelOptions): void {
  const { runId, enabled } = options;
  const client = useLiveSocket();
  const latest = useLatest(options);

  useEffect(() => {
    if (!enabled || client === null) {
      return;
    }
    const handle = client.open({
      kind: "run",
      subject: runId,
      after: () => latest.current.afterId,
      onFrame: (frame) => latest.current.onFrame(frame),
      onState: (state) => latest.current.onConnectionChange(state),
    });

    return handle.close;
  }, [runId, enabled, client, latest]);
}

// The callbacks and the cursor live in one ref: afterId changes on EVERY live event and an inline closure changes every render, so neither may sit in the channel effect's deps or each event would close and reopen the channel.
function useLatest(options: RunChannelOptions) {
  const latest = useRef(options);

  useEffect(() => {
    latest.current = options;
  });

  return latest;
}
