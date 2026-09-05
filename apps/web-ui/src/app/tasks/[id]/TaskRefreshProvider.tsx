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
import type { ConnectionState } from "@/app/assembly-runs/[id]/run-stream-presenter";
import { useRunEventStream } from "@/app/assembly-runs/[id]/useRunEventStream";
import type { RunStreamEvent } from "@/lib/run-stream-types";
import {
  eventRefreshDelayMs,
  maxEventId,
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
  // Offline fallback: switch to coordinated polling.
  const onConnectionChange = useCallback((next: ConnectionState) => {
    setConnection(next);

    if (next === "offline") {
      setStreamUnavailable(true);
    }
  }, []);
  const onLiveRunFound = useCallback((found: string | null) => {
    if (found !== null) {
      setStreamUnavailable(false);
      setConnection("connecting");
    }
    setLiveRunId(found);
  }, []);

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

/** Which panels exist and which are currently worth refreshing. A panel deregisters by calling what `register` returned, so an unmounted panel cannot be ticked. */
function usePanelRegistry() {
  const registryRef = useRef(new Map<string, Refresh>());
  const [activeIds, setActiveIds] = useState<ReadonlySet<string>>(new Set());
  const activeIdsRef = useRef(activeIds);

  useEffect(() => {
    activeIdsRef.current = activeIds;
  }, [activeIds]);

  const setActive = useCallback((id: string, active: boolean) => {
    setActiveIds((prev) => withMember(prev, id, active));
  }, []);
  const register = useCallback(
    (id: string, refresh: Refresh) => {
      registryRef.current.set(id, refresh);

      return () => {
        registryRef.current.delete(id);
        setActive(id, false);
      };
    },
    [setActive],
  );
  const refreshAll = useCallback(() => {
    for (const id of activeIdsRef.current) {
      void registryRef.current.get(id)?.();
    }
  }, []);

  return {
    register,
    setActive,
    refreshAll,
    anyPanelActive: activeIds.size > 0,
  };
}

/** Returns the same set when nothing changes, so a no-op toggle cannot re-render every panel. */
function withMember(
  set: ReadonlySet<string>,
  id: string,
  member: boolean,
): ReadonlySet<string> {
  if (set.has(id) === member) {
    return set;
  }
  const next = new Set(set);

  if (member) {
    next.add(id);
  }

  if (!member) {
    next.delete(id);
  }

  return next;
}

/** Coalesces an event burst: refresh immediately when past the throttle, otherwise once at the boundary. Seeded at mount so stream catch-up does not fire a duplicate wave. */
function useCoalescedRefresh(
  refreshAll: () => void,
  setAfterId: (update: (prev: string) => string) => void,
) {
  const lastRefreshAtRef = useRef(0);
  const trailingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    lastRefreshAtRef.current = Date.now();

    return () => {
      if (trailingTimerRef.current !== null) {
        clearTimeout(trailingTimerRef.current);
      }
    };
  }, []);

  return useCallback(
    (event: RunStreamEvent) => {
      setAfterId((prev) => maxEventId(prev, event.id));

      const delayMs = eventRefreshDelayMs(lastRefreshAtRef.current, Date.now());
      const run = () => {
        lastRefreshAtRef.current = Date.now();
        refreshAll();
      };

      if (delayMs === 0) {
        run();

        return;
      }

      if (trailingTimerRef.current === null) {
        trailingTimerRef.current = setTimeout(() => {
          trailingTimerRef.current = null;
          run();
        }, delayMs);
      }
    },
    [refreshAll, setAfterId],
  );
}

/** The polling half: refresh every panel on a tick and — while discovery is active — re-read the task's runs to attach a fresh live run or detach a terminal one. */
function useRefreshTicker({
  intervalMs,
  taskId,
  refreshAll,
  discoveryActive,
  liveRunId,
  onLiveRunFound,
}: {
  intervalMs: number | null;
  taskId: string;
  refreshAll: () => void;
  discoveryActive: boolean;
  liveRunId: string | null;
  onLiveRunFound: (runId: string | null) => void;
}): void {
  const discoveryActiveRef = useRef(discoveryActive);
  const liveRunIdRef = useRef(liveRunId);

  useEffect(() => {
    discoveryActiveRef.current = discoveryActive;
    liveRunIdRef.current = liveRunId;
  }, [discoveryActive, liveRunId]);

  useEffect(() => {
    if (intervalMs === null) {
      return;
    }

    let inFlight = false;
    let cancelled = false;

    async function discoverRun() {
      if (inFlight) {
        return;
      }

      inFlight = true;

      try {
        const found = await fetchLiveRun(taskId);

        if (!cancelled && found !== liveRunIdRef.current) {
          onLiveRunFound(found);
        }
      } catch {
        // The next tick retries.
      } finally {
        inFlight = false;
      }
    }
    const handle = setInterval(() => {
      refreshAll();

      if (discoveryActiveRef.current) {
        void discoverRun();
      }
    }, intervalMs);

    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [intervalMs, taskId, refreshAll, onLiveRunFound]);
}

/** The task's runs, reduced to the one that is live — or null when none is. */
async function fetchLiveRun(taskId: string): Promise<string | null> {
  const res = await fetch(`/api/tasks/${taskId}/runs`, {
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    return null;
  }
  const body = (await res.json()) as { runs?: unknown[] };
  const candidates = (Array.isArray(body.runs) ? body.runs : []).filter(
    (row): row is LiveRunCandidate => {
      const r = row as Partial<LiveRunCandidate> | null;

      return (
        typeof r?.id === "string" &&
        typeof r.status === "string" &&
        typeof r.created_at === "string"
      );
    },
  );

  return pickLiveRun(candidates);
}
