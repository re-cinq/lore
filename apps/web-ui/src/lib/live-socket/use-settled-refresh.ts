"use client";

// One re-read per burst of live frames: a settling node fires more than one frame back to back, and a single debounced router.refresh() covers all of them.
import { useRouter } from "next/navigation";
import { useDebouncedCallback } from "../use-debounced-callback";

export function useSettledRefresh(settleMs: number): () => void {
  const router = useRouter();

  return useDebouncedCallback(() => router.refresh(), settleMs);
}
