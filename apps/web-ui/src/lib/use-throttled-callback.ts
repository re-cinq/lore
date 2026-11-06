"use client";

// At most one call per `everyMs`: the first call runs at once, and the calls inside the window collapse into one call at its end.
import { useEffect, useRef, type RefObject } from "react";

interface Throttle {
  lastAt: number;
  trailing: ReturnType<typeof setTimeout> | null;
}

export function useThrottledCallback(
  callback: () => void,
  everyMs: number,
): () => void {
  const latest = useRef(callback);
  const throttle = useRef<Throttle>({
    lastAt: Number.NEGATIVE_INFINITY,
    trailing: null,
  });

  useEffect(() => {
    latest.current = callback;
  });
  useEffect(
    () => () => clearTimeout(throttle.current.trailing ?? undefined),
    [],
  );

  return () => schedule(throttle.current, everyMs, latest);
}

function schedule(
  throttle: Throttle,
  everyMs: number,
  latest: RefObject<() => void>,
): void {
  const run = () => {
    clearTimeout(throttle.trailing ?? undefined);
    throttle.trailing = null;
    throttle.lastAt = Date.now();
    latest.current();
  };
  const wait = throttle.lastAt + everyMs - Date.now();

  if (wait <= 0) {
    run();

    return;
  }
  throttle.trailing ??= setTimeout(run, wait);
}
