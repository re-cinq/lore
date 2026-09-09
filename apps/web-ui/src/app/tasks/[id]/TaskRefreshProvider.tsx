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
import type { RunStreamEvent } from "@/lib/run-stream-types";
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

interface StreamCallbackOptions {
  setConnection: (state: ConnectionState) => void;
  setStreamUnavailable: (unavailable: boolean) => void;
  setLiveRunId: (id: string | null) => void;
}

/** Going offline latches the stream as unavailable, dropping the page to coordinated polling. */
function useConnectionChange(
  setConnection: (state: ConnectionState) => void,
  setStreamUnavailable: (unavailable: boolean) => void,
) {
  return useCallback(
    (next: ConnectionState) => {
      setConnection(next);

      if (next === "offline") {
        setStreamUnavailable(true);
      }
    },
    [setConnection, setStreamUnavailable],
  );
}

/** Discovering a live run clears that latch and tries the stream again, because a fresh run is a fresh chance for it to work. */
function useLiveRunFound(options: StreamCallbackOptions) {
  const { setConnection, setStreamUnavailable, setLiveRunId } = options;

  return useCallback(
    (found: string | null) => {
      if (found !== null) {
        setStreamUnavailable(false);
        setConnection("connecting");
      }
      setLiveRunId(found);
    },
    [setConnection, setStreamUnavailable, setLiveRunId],
  );
}

/** The two transitions that change HOW the page refreshes. */
function useStreamCallbacks(options: StreamCallbackOptions) {
  const { setConnection, setStreamUnavailable } = options;

  return {
    onConnectionChange: useConnectionChange(
      setConnection,
      setStreamUnavailable,
    ),
    onLiveRunFound: useLiveRunFound(options),
  };
}

/** Stream or poll. `EventSource` is probed rather than assumed: it is absent under SSR and in the test environment, and a page that assumed it would never fall back to polling there. */
function pickDriver(
  liveRunId: string | null,
  streamUnavailable: boolean,
  anyPanelActive: boolean,
) {
  return resolveRefreshDriver({
    liveRunId,
    eventSourceAvailable: typeof EventSource !== "undefined",
    streamUnavailable,
    anyPanelActive,
  });
}

interface RefreshDriverOptions {
  taskId: string;
  taskStatus: string;
  /** The task's runs at first render — the seed for which one is live. */
  runs: readonly LiveRunCandidate[];
}

interface DriverSubscriptionOptions {
  taskId: string;
  taskStatus: string;
  driver: ReturnType<typeof resolveRefreshDriver>;
  connection: ConnectionState;
  liveRunId: string | null;
  afterId: string;
  anyPanelActive: boolean;
  refreshAll: () => void;
  onEvent: (event: RunStreamEvent) => void;
  onConnectionChange: (state: ConnectionState) => void;
  onLiveRunFound: (runId: string | null) => void;
}

function useStreamSubscription(opts: DriverSubscriptionOptions) {
  const { driver, liveRunId } = opts;

  useRunEventStream({
    runId: liveRunId ?? "",
    afterId: opts.afterId,
    enabled: driver === "stream" && liveRunId !== null,
    onEvent: opts.onEvent,
    onConnectionChange: opts.onConnectionChange,
  });
}

function useTickerSubscription(opts: DriverSubscriptionOptions) {
  const { driver, liveRunId, taskStatus, anyPanelActive } = opts;

  useRefreshTicker({
    intervalMs: refreshIntervalMs(driver, opts.connection),
    taskId: opts.taskId,
    refreshAll: opts.refreshAll,
    discoveryActive: runDiscoveryActive({
      liveRunId,
      taskStatus,
      anyPanelActive,
    }),
    liveRunId,
    onLiveRunFound: opts.onLiveRunFound,
  });
}

/** Both ways of staying current, subscribed together. Neither is conditional: the stream hook is disabled rather than unmounted, and the ticker takes a null interval rather than being skipped, because a hook that comes and goes with the driver would break the rules of hooks the moment the fallback fires. */
function useDriverSubscriptions(opts: DriverSubscriptionOptions) {
  useStreamSubscription(opts);
  useTickerSubscription(opts);
}

/** Everything the driver needs to remember across renders, plus the two callbacks that change it. */
function useDriverState(runs: readonly LiveRunCandidate[]) {
  const [liveRunId, setLiveRunId] = useState(() => pickLiveRun(runs));
  const [streamUnavailable, setStreamUnavailable] = useState(false);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [afterId, setAfterId] = useState("0");
  const { onConnectionChange, onLiveRunFound } = useStreamCallbacks({
    setConnection,
    setStreamUnavailable,
    setLiveRunId,
  });

  return {
    liveRunId,
    streamUnavailable,
    connection,
    afterId,
    setAfterId,
    onConnectionChange,
    onLiveRunFound,
  };
}

/** Chooses how this page stays current and keeps it that way. The stream is preferred; falling back to POLLING is a one-way move within a mount — once the stream has proved unavailable, retrying it per render would reconnect on every refresh. Discovery keeps looking for a live run while the task is unfinished, because a run can start after the page loaded. */
function useRefreshDriver({ taskId, taskStatus, runs }: RefreshDriverOptions) {
  const state = useDriverState(runs);
  const { liveRunId, streamUnavailable, connection } = state;
  const { register, setActive, refreshAll, anyPanelActive } =
    usePanelRegistry();
  const driver = pickDriver(liveRunId, streamUnavailable, anyPanelActive);
  const onEvent = useCoalescedRefresh(refreshAll, state.setAfterId);

  useDriverSubscriptions({
    ...state,
    taskId,
    taskStatus,
    driver,
    anyPanelActive,
    refreshAll,
    onEvent,
  });

  return { register, setActive, driver, connection };
}

import {
  usePanelRegistry,
  useCoalescedRefresh,
  useRefreshTicker,
} from "./refresh-mechanics";

/** The context the panels read: who to call on a tick, and whether the page is genuinely live. */
function useRefreshContextValue(
  options: RefreshDriverOptions,
): TaskRefreshContextValue {
  const { register, setActive, driver, connection } = useRefreshDriver(options);
  const live = driver === "stream" && connection === "live";

  return useMemo(
    () => ({ register, setActive, live }),
    [register, setActive, live],
  );
}

interface TaskRefreshProviderProps {
  taskId: string;
  taskStatus: string;
  runs: readonly LiveRunCandidate[];
  children: ReactNode;
}

export default function TaskRefreshProvider({
  taskId,
  taskStatus,
  runs,
  children,
}: TaskRefreshProviderProps) {
  const value = useRefreshContextValue({ taskId, taskStatus, runs });

  return (
    <TaskRefreshContext.Provider value={value}>
      {children}
    </TaskRefreshContext.Provider>
  );
}
