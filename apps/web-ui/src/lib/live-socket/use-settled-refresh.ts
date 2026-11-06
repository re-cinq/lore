"use client";

// At most one re-read per `everyMs`: each refresh re-reads every route the page renders, and a busy floor's frames would otherwise spend the person's whole lore-api budget.
import { useRouter } from "next/navigation";
import { useThrottledCallback } from "../use-throttled-callback";

export function useSettledRefresh(everyMs: number): () => void {
  const router = useRouter();

  return useThrottledCallback(() => router.refresh(), everyMs);
}
