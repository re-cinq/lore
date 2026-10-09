"use client";

// One call per burst: repeats inside `delayMs` collapse into the single call that follows the last one.
import { useEffect, useRef, type RefObject } from "react";

export function useDebouncedCallback(
  callback: () => void,
  delayMs: number,
): () => void {
  const latest = useRef(callback);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    latest.current = callback;
  });
  useEffect(() => () => clear(timer), []);

  return () => {
    clear(timer);
    timer.current = setTimeout(() => latest.current(), delayMs);
  };
}

function clear(timer: RefObject<ReturnType<typeof setTimeout> | null>): void {
  if (timer.current) {
    clearTimeout(timer.current);
  }
}
