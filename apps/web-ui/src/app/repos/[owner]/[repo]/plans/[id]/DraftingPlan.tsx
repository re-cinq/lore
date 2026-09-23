"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Skeleton from "@/components/Skeleton";
import styles from "./DraftingPlan.module.scss";

const REFRESH_MS = 5_000;

/** Stands in for the editor while the planning agent writes the first draft, which would overwrite anything typed meanwhile; reloads the page until the draft is in. */
export default function DraftingPlan() {
  useRefreshEvery(REFRESH_MS);

  return (
    <div className={`spec-card ${styles.drafting}`}>
      <p role="status" className="meta">
        The planning agent is writing this plan. It opens here as soon as the
        draft is ready.
      </p>
      <Skeleton width="40%" height={20} />
      <Skeleton />
      <Skeleton width="85%" />
      <Skeleton width="60%" />
    </div>
  );
}

function useRefreshEvery(intervalMs: number) {
  const router = useRouter();

  useEffect(() => {
    const timer = setInterval(() => router.refresh(), intervalMs);

    return () => clearInterval(timer);
  }, [router, intervalMs]);
}
