"use client";

// One re-read per burst of live frames: a settling node fires more than one frame back to back, and a single debounced router.refresh() covers all of them.
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

export function useSettledRefresh(settleMs: number): () => void {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
      }
    },
    [],
  );

  return () => {
    if (timer.current) {
      clearTimeout(timer.current);
    }
    timer.current = setTimeout(() => router.refresh(), settleMs);
  };
}
