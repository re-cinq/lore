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
  const registryRef = useRef(new Map<string, Refresh>());
  const [activeIds, setActiveIds] = useState<ReadonlySet<string>>(new Set());
  const [liveRunId, setLiveRunId] = useState(() => pickLiveRun(runs));
  const [streamUnavailable, setStreamUnavailable] = useState(false);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [afterId, setAfterId] = useState("0");
  const lastRefreshAtRef = useRef(0);
  const trailingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeIdsRef = useRef(activeIds);
  const liveRunIdRef = useRef(liveRunId);

  // Seed timestamp before stream catch-up to avoid duplicate refresh wave.
  useEffect(() => {
    lastRefreshAtRef.current = Date.now();
  }, []);

  useEffect(
    () => () => {
      if (trailingTimerRef.current !== null) {
        clearTimeout(trailingTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    activeIdsRef.current = activeIds;
  }, [activeIds]);

  useEffect(() => {
    liveRunIdRef.current = liveRunId;
  }, [liveRunId]);

  const register = useCallback((id: string, refresh: Refresh) => {
    registryRef.current.set(id, refresh);

    return () => {
      registryRef.current.delete(id);
      setActiveIds((prev) => {
        if (!prev.has(id)) {
          return prev;
        }
        const next = new Set(prev);

        next.delete(id);

        return next;
      });
    };
  }, []);

  const setActive = useCallback((id: string, active: boolean) => {
    setActiveIds((prev) => {
      if (prev.has(id) === active) {
        return prev;
      }
      const next = new Set(prev);

      if (active) {
        next.add(id);

        return next;
      }
      next.delete(id);

      return next;
    });
  }, []);

  const refreshAll = useCallback(() => {
    lastRefreshAtRef.current = Date.now();

    for (const id of activeIdsRef.current) {
      void registryRef.current.get(id)?.();
    }
  }, []);

  const anyPanelActive = activeIds.size > 0;
  const driver = resolveRefreshDriver({
    liveRunId,
    eventSourceAvailable: typeof EventSource !== "undefined",
    streamUnavailable,
    anyPanelActive,
  });

  // Coalesce event burst: immediate if past throttle, else trailing at boundary.
  const onEvent = useCallback(
    (event: RunStreamEvent) => {
      setAfterId((prev) => maxEventId(prev, event.id));

      const delayMs = eventRefreshDelayMs(lastRefreshAtRef.current, Date.now());

      if (delayMs === 0) {
        refreshAll();

        return;
      }

      if (trailingTimerRef.current !== null) {
        return;
      }

      trailingTimerRef.current = setTimeout(() => {
        trailingTimerRef.current = null;
        refreshAll();
      }, delayMs);
    },
    [refreshAll],
  );

  // Offline fallback: switch to coordinated polling.
  const onConnectionChange = useCallback((next: ConnectionState) => {
    setConnection(next);

    if (next === "offline") {
      setStreamUnavailable(true);
    }
  }, []);

  useRunEventStream({
    runId: liveRunId ?? "",
    afterId,
    enabled: driver === "stream" && liveRunId !== null,
    onEvent,
    onConnectionChange,
  });

  const intervalMs = refreshIntervalMs(driver, connection);
  const discoveryActive = runDiscoveryActive({
    liveRunId,
    taskStatus,
    anyPanelActive,
  });
  const discoveryActiveRef = useRef(discoveryActive);

  useEffect(() => {
    discoveryActiveRef.current = discoveryActive;
  }, [discoveryActive]);

  useEffect(() => {
    if (intervalMs === null) {
      return;
    }

    let inFlight = false;
    let cancelled = false;

    // Discovery re-reads recorded runs to attach fresh live run or detach terminal ones.
    async function discoverRun() {
      if (inFlight) {
        return;
      }

      inFlight = true;

      try {
        const res = await fetch(`/api/tasks/${taskId}/runs`, {
          signal: AbortSignal.timeout(15_000),
        });

        if (!res.ok) {
          return;
        }

        const body = (await res.json()) as { runs?: unknown[] };

        if (cancelled) {
          return;
        }

        const candidates = (Array.isArray(body.runs) ? body.runs : []).filter(
          (row): row is LiveRunCandidate => {
            const r = row as Partial<LiveRunCandidate> | null;

            return (
              typeof r?.id === "string" &&
              typeof r?.status === "string" &&
              typeof r?.created_at === "string"
            );
          },
        );
        const found = pickLiveRun(candidates);

        if (found === liveRunIdRef.current) {
          return;
        }

        if (found !== null) {
          setStreamUnavailable(false);
          setConnection("connecting");
        }

        setLiveRunId(found);
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
  }, [intervalMs, taskId, refreshAll]);

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
