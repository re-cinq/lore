"use client";

// Single coordinated refresh cadence for all panels; IO shell for task-refresh-presenter logic.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import type { ConnectionState } from "@/lib/run-stream-presenter";
import { useRunEventStream } from "@/app/assembly-runs/[id]/useRunEventStream";
import {
  pickLiveRun,
  refreshIntervalMs,
  resolveRefreshDriver,
  runDiscoveryActive,
  type LiveRunCandidate,
} from "./task-refresh-presenter";

type Refresh = () => void | Promise<void>;

interface TaskRefreshContextValue {
  register: (id: string, refresh: Refresh) => () => void;
  setActive: (id: string, active: boolean) => void;
  live: boolean;
}

// Default context is inert (for tests without the provider).
const TaskRefreshContext = createContext<TaskRefreshContextValue>({
  register: () => () => {},
  setActive: () => {},
  live: false,
});

/** Registers a panel's refresh callback; keeps latest closure via ref. */
export function useCoordinatedRefresh(
  refresh: Refresh,
  active: boolean,
): { live: boolean } {
  const { register, setActive, live } = useContext(TaskRefreshContext);
  const id = useId();
  const refreshRef = useRef(refresh);

  useEffect(() => {
    refreshRef.current = refresh;
  });

  useEffect(() => register(id, () => refreshRef.current()), [register, id]);

  useEffect(() => {
    setActive(id, active);
  }, [setActive, id, active]);

  return { live };
}

/** The two transitions that change HOW the page refreshes. Going offline latches the stream as unavailable, dropping the page to coordinated polling; discovering a live run clears that latch and tries the stream again, because a fresh run is a fresh chance for it to work. */
function useStreamCallbacks({
  setConnection,
  setStreamUnavailable,
  setLiveRunId,
}: {
  setConnection: (state: ConnectionState) => void;
  setStreamUnavailable: (unavailable: boolean) => void;
  setLiveRunId: (id: string | null) => void;
}) {
  const onConnectionChange = useCallback(
    (next: ConnectionState) => {
      setConnection(next);

      if (next === "offline") {
        setStreamUnavailable(true);
      }
    },
    [setConnection, setStreamUnavailable],
  );
  const onLiveRunFound = useCallback(
    (found: string | null) => {
      if (found !== null) {
        setStreamUnavailable(false);
        setConnection("connecting");
      }
      setLiveRunId(found);
    },
    [setConnection, setStreamUnavailable, setLiveRunId],
  );

  return { onConnectionChange, onLiveRunFound };
}

/** Chooses how this page stays current and keeps it that way. The stream is preferred; falling back to POLLING is a one-way move within a mount — once the stream has proved unavailable, retrying it per render would reconnect on every refresh. Discovery keeps looking for a live run while the task is unfinished, because a run can start after the page loaded. */
function useRefreshDriver({
  taskId,
  taskStatus,
  runs,
}: {
  taskId: string;
  taskStatus: string;
  runs: readonly LiveRunCandidate[];
}) {
  const [liveRunId, setLiveRunId] = useState(() => pickLiveRun(runs));
  const [streamUnavailable, setStreamUnavailable] = useState(false);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [afterId, setAfterId] = useState("0");
  const { register, setActive, refreshAll, anyPanelActive } =
    usePanelRegistry();
  const driver = resolveRefreshDriver({
    liveRunId,
    eventSourceAvailable: typeof EventSource !== "undefined",
    streamUnavailable,
    anyPanelActive,
  });
  const onEvent = useCoalescedRefresh(refreshAll, setAfterId);
  const { onConnectionChange, onLiveRunFound } = useStreamCallbacks({
    setConnection,
    setStreamUnavailable,
    setLiveRunId,
  });

  useRunEventStream({
    runId: liveRunId ?? "",
    afterId,
    enabled: driver === "stream" && liveRunId !== null,
    onEvent,
    onConnectionChange,
  });
  useRefreshTicker({
    intervalMs: refreshIntervalMs(driver, connection),
    taskId,
    refreshAll,
    discoveryActive: runDiscoveryActive({
      liveRunId,
      taskStatus,
      anyPanelActive,
    }),
    liveRunId,
    onLiveRunFound,
  });

  return { register, setActive, driver, connection };
}

import {
  usePanelRegistry,
  useCoalescedRefresh,
  useRefreshTicker,
} from "./refresh-mechanics";

export default function TaskRefreshProvider({
  taskId,
  taskStatus,
  runs,
  children,
}: {
  taskId: string;
  taskStatus: string;
  runs: readonly LiveRunCandidate[];
  children: ReactNode;
}) {
  const { register, setActive, driver, connection } = useRefreshDriver({
    taskId,
    taskStatus,
    runs,
  });
  const live = driver === "stream" && connection === "live";
  const value = useMemo(
    () => ({ register, setActive, live }),
    [register, setActive, live],
  );

  return (
    <TaskRefreshContext.Provider value={value}>
      {children}
    </TaskRefreshContext.Provider>
  );
}
