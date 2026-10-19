"use client";

// The run list's channel on the tab's live socket: opened once, closed on unmount, told which runs the page shows. Backoff and token refresh are the socket client's.
import { useEffect, useRef, type RefObject } from "react";
import type { ChannelHandle, LiveSocketClient } from "@/lib/live-socket/client";
import type { ChannelState } from "@/lib/live-socket/connection-machine";
import { useLiveSocket } from "@/lib/live-socket/LiveSocketProvider";
import type { RunListFrame } from "@/lib/live-socket/protocol";
import { openRunsChannelAction } from "./runs-live-actions";

export interface RunsChannelOptions {
  runIds: readonly string[];
  onFrame: (frame: RunListFrame) => void;
  onConnectionChange: (state: ChannelState) => void;
}

export function useRunsChannel(options: RunsChannelOptions): void {
  const latest = useRef(options);
  const handle = useRunsHandle(latest);
  const watchedIds = options.runIds.join(",");

  useEffect(() => {
    latest.current = options;
  });

  useEffect(() => {
    handle.current?.watch(latest.current.runIds);
  }, [watchedIds, handle]);
}

function useRunsHandle(latest: RefObject<RunsChannelOptions>) {
  const client = useLiveSocket();
  const handle = useRef<ChannelHandle | null>(null);

  useEffect(() => {
    if (client === null) {
      return;
    }
    const opened = openRunsChannel(client, latest);

    handle.current = opened;
    opened.watch(latest.current.runIds);

    return () => {
      handle.current = null;
      opened.close();
    };
  }, [client, latest]);

  return handle;
}

function openRunsChannel(
  client: LiveSocketClient,
  latest: RefObject<RunsChannelOptions>,
): ChannelHandle {
  return client.open({
    kind: "runs",
    subject: "floor",
    token: tokenForRuns,
    onRunsFrame: (frame) => latest.current.onFrame(frame),
    onState: (state) => latest.current.onConnectionChange(state),
  });
}

/** A refused grant throws, which the client reads as a failed open and retries after a pause. */
async function tokenForRuns(): Promise<string> {
  const grant = await openRunsChannelAction();

  if ("error" in grant) {
    throw new Error(grant.error);
  }

  return grant.token;
}
