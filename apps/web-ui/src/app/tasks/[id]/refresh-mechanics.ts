// When the task page refreshes; the context panels register with lives in TaskRefreshProvider.

import { useCallback, useEffect, useRef, useState } from "react";
import type { RunStreamEvent } from "@/lib/run-stream-types";
import {
  eventRefreshDelayMs,
  maxEventId,
  pickLiveRun,
  type LiveRunCandidate,
} from "./task-refresh-presenter";

type Refresh = () => void | Promise<void>;

/** Whether a panel is worth ticking, named so the caller reads as a registration rather than a bare flag. */
export interface Membership {
  active: boolean;
}

/** Which panel ids are worth ticking, as both state and a ref. The ref exists so the tick callback can read the current set without being rebuilt — and therefore without restarting the interval — every time a panel comes or goes. */
function useActiveIds() {
  const [activeIds, setActiveIds] = useState<ReadonlySet<string>>(new Set());
  const activeIdsRef = useRef(activeIds);

  useEffect(() => {
    activeIdsRef.current = activeIds;
  }, [activeIds]);

  const setActive = useCallback((id: string, { active }: Membership) => {
    setActiveIds((prev) => (active ? withId(prev, id) : withoutId(prev, id)));
  }, []);

  return { activeIds, activeIdsRef, setActive };
}

/** Registering hands back the deregistration, so an unmounted panel cannot be ticked. */
function useRegister(
  registryRef: { current: Map<string, Refresh> },
  setActive: (id: string, next: Membership) => void,
) {
  return useCallback(
    (id: string, refresh: Refresh) => {
      registryRef.current.set(id, refresh);

      return () => {
        registryRef.current.delete(id);
        setActive(id, { active: false });
      };
    },
    [registryRef, setActive],
  );
}

/** Which panels exist and which are currently worth refreshing. A panel deregisters by calling what `register` returned, so an unmounted panel cannot be ticked. */
export function usePanelRegistry() {
  const registryRef = useRef(new Map<string, Refresh>());
  const { activeIds, activeIdsRef, setActive } = useActiveIds();
  const register = useRegister(registryRef, setActive);
  const refreshAll = useCallback(() => {
    for (const id of activeIdsRef.current) {
      void registryRef.current.get(id)?.();
    }
  }, [activeIdsRef]);

  return {
    register,
    setActive,
    refreshAll,
    anyPanelActive: activeIds.size > 0,
  };
}

/** Returns the same set when the id is already there, so a no-op toggle cannot re-render every panel. */
export function withId(
  set: ReadonlySet<string>,
  id: string,
): ReadonlySet<string> {
  return set.has(id) ? set : new Set(set).add(id);
}

/** Returns the same set when the id is already gone, for the same reason. */
export function withoutId(
  set: ReadonlySet<string>,
  id: string,
): ReadonlySet<string> {
  if (!set.has(id)) {
    return set;
  }
  const next = new Set(set);

  next.delete(id);

  return next;
}

/** Now, or once at the throttle boundary. A burst that arrives inside the window schedules ONE trailing refresh and every later event in that burst is absorbed by it — the timer being non-null is what says a refresh is already owed. */
function scheduleBurst(
  lastRefreshAtRef: { current: number },
  trailingTimerRef: { current: ReturnType<typeof setTimeout> | null },
  run: () => void,
) {
  const delayMs = eventRefreshDelayMs(lastRefreshAtRef.current, Date.now());

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
}

/** Seeds the throttle window at mount so stream catch-up does not fire a duplicate wave, and drops any refresh still owed when the page goes away. */
function useBurstWindow(
  lastRefreshAtRef: { current: number },
  trailingTimerRef: { current: ReturnType<typeof setTimeout> | null },
) {
  useEffect(() => {
    lastRefreshAtRef.current = Date.now();

    return () => {
      if (trailingTimerRef.current !== null) {
        clearTimeout(trailingTimerRef.current);
      }
    };
  }, [lastRefreshAtRef, trailingTimerRef]);
}

/** Coalesces an event burst: refresh immediately when past the throttle, otherwise once at the boundary. Seeded at mount so stream catch-up does not fire a duplicate wave. */
export function useCoalescedRefresh(
  refreshAll: () => void,
  setAfterId: (update: (prev: string) => string) => void,
) {
  const lastRefreshAtRef = useRef(0);
  const trailingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useBurstWindow(lastRefreshAtRef, trailingTimerRef);

  return useCallback(
    (event: RunStreamEvent) => {
      setAfterId((prev) => maxEventId(prev, event.id));

      const run = () => {
        lastRefreshAtRef.current = Date.now();
        refreshAll();
      };

      scheduleBurst(lastRefreshAtRef, trailingTimerRef, run);
    },
    [refreshAll, setAfterId],
  );
}

/** A poll slower than its interval must NOT stack requests behind itself, so a call made while one is in flight is skipped rather than queued. */
function singleFlight(task: () => Promise<void>) {
  let inFlight = false;

  return async () => {
    if (inFlight) {
      return;
    }
    inFlight = true;

    try {
      await task();
    } finally {
      inFlight = false;
    }
  };
}

/** A cancelled discovery drops its result instead of reporting a run the page has navigated away from. A failed lookup is silent — the next tick retries. */
async function reportLiveRun(
  taskId: string,
  liveRunIdRef: { current: string | null },
  onLiveRunFound: (runId: string | null) => void,
  isCancelled: () => boolean,
) {
  try {
    const found = await fetchLiveRun(taskId);

    if (!isCancelled() && found !== liveRunIdRef.current) {
      onLiveRunFound(found);
    }
  } catch {
    // The next tick retries.
  }
}

/** Single-flight run discovery: one lookup at a time, and none at all once cancelled. */
export function runDiscovery(
  taskId: string,
  liveRunIdRef: { current: string | null },
  onLiveRunFound: (runId: string | null) => void,
) {
  let cancelled = false;

  return {
    cancel: () => {
      cancelled = true;
    },
    run: singleFlight(() =>
      reportLiveRun(taskId, liveRunIdRef, onLiveRunFound, () => cancelled),
    ),
  };
}

interface TickerOptions {
  intervalMs: number;
  taskId: string;
  refreshAll: () => void;
  discoveryActiveRef: { current: boolean };
  liveRunIdRef: { current: string | null };
  onLiveRunFound: (runId: string | null) => void;
}

/** The interval itself, and how to stop it. Discovery is read from a ref rather than taken as a value so that turning it on or off does not tear down and restart the interval mid-cycle. */
function startTicker({
  intervalMs,
  taskId,
  refreshAll,
  discoveryActiveRef,
  liveRunIdRef,
  onLiveRunFound,
}: TickerOptions) {
  const discovery = runDiscovery(taskId, liveRunIdRef, onLiveRunFound);
  const handle = setInterval(() => {
    refreshAll();

    if (discoveryActiveRef.current) {
      void discovery.run();
    }
  }, intervalMs);

  return () => {
    discovery.cancel();
    clearInterval(handle);
  };
}

/** The polling half: refresh every panel on a tick and — while discovery is active — re-read the task's runs to attach a fresh live run or detach a terminal one. */
interface RefreshTickerOptions {
  /** null stops the ticker entirely — a terminal task is not polled. */
  intervalMs: number | null;
  taskId: string;
  refreshAll: () => void;
  /** Whether to also look for a run that has since become live. */
  discoveryActive: boolean;
  liveRunId: string | null;
  onLiveRunFound: (runId: string | null) => void;
}

/** Discovery inputs held as refs, so toggling either one does not tear down and restart the interval mid-cycle. */
function useDiscoveryRefs(
  discovery: Pick<RefreshTickerOptions, "discoveryActive" | "liveRunId">,
) {
  const { discoveryActive, liveRunId } = discovery;
  const discoveryActiveRef = useRef(discoveryActive);
  const liveRunIdRef = useRef(liveRunId);

  useEffect(() => {
    discoveryActiveRef.current = discoveryActive;
    liveRunIdRef.current = liveRunId;
  }, [discoveryActive, liveRunId]);

  return { discoveryActiveRef, liveRunIdRef };
}

export function useRefreshTicker(options: RefreshTickerOptions): void {
  const { intervalMs, taskId, refreshAll, onLiveRunFound } = options;
  const { discoveryActiveRef, liveRunIdRef } = useDiscoveryRefs(options);

  useEffect(() => {
    if (intervalMs === null) {
      return;
    }

    return startTicker({
      intervalMs,
      taskId,
      refreshAll,
      discoveryActiveRef,
      liveRunIdRef,
      onLiveRunFound,
    });
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
