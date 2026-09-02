"use client";

// The task page's one refresh scheduler. The three data panels (timeline, logs,
// PR status) used to each own a setInterval against their endpoint; this
// provider replaces those with a single coordinated cadence, and — when the
// task has a live assembly-line run — rides the existing run event stream as
// an activity signal. Stream events only ever trigger refetches of the REST
// endpoints; no event payload reaches panel state, so recorded outcomes stay
// the only source badges render from. Every decision here is computed in
// task-refresh-presenter; this file is the IO shell.

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

// The default is deliberately inert: a panel rendered without the provider
// (isolation tests, storybook-style harnesses) keeps its mount fetch and
// simply never auto-refreshes.
const TaskRefreshContext = createContext<TaskRefreshContextValue>({
  register: () => () => {},
  setActive: () => {},
  live: false,
});

/**
 * Registers a panel's refresh callback with the page coordinator. The callback
 * is held in a ref so the latest closure always runs (fetchers whose
 * useCallback identity shifts with their own state — the log offset fetcher —
 * need no special handling). `active` mirrors the panel's own poll gate; an
 * inactive panel is skipped on ticks and, once every panel is inactive, the
 * coordinator stops scheduling entirely.
 */
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

  // Seeded at mount (an effect — Date.now during render is impure): the panels
  // just fetched on their own mount effects, so the stream's catch-up replay
  // burst must not trigger an immediate re-fetch wave. This effect runs before
  // the stream effect can deliver any event.
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

  // Immediate refresh past the throttle window; inside it, one trailing
  // refresh at the boundary so a burst's final events (the outcome writes)
  // never wait for the heartbeat.
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

  // "offline" from the hook means it gave up for good; flipping
  // streamUnavailable hands the page to the coordinated poll — the same
  // degradation the assembly-runs panel uses.
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

    // Re-read the recorded run rows: attach a fresh live run, detach when the
    // attached one turned terminal (a live stream never closes on its own),
    // and give a replacement run a clean stream chance even after a prior
    // give-up latched streamUnavailable.
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
