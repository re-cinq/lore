"use client";

import { useEffect, useState } from "react";
import type { components } from "@/lib/api/schema";

type BlockedReason = Pick<components["schemas"]["BlockedReason"], "label">;

type BlockedReasonState =
  | { status: "idle" }
  | { status: "ready"; label: string }
  | { status: "unavailable" };

export interface BlockedReasonBannerProps {
  repo: string;
  prNumber: number | null;
  runStatus: string;
  refreshKey?: string;
}

const REQUEST_TIMEOUT_MS = 15_000;
const REFRESH_INTERVAL_MS = 15_000;
const UNAVAILABLE_MESSAGE = "Blocked reason unavailable.";

export default function BlockedReasonBanner(props: BlockedReasonBannerProps) {
  const state = useBlockedReason(props);

  if (state.status === "idle") {
    return null;
  }

  return (
    <div role="status">
      {state.status === "unavailable" ? UNAVAILABLE_MESSAGE : state.label}
    </div>
  );
}

function useBlockedReason({
  repo,
  prNumber,
  runStatus,
  refreshKey,
}: BlockedReasonBannerProps): BlockedReasonState {
  const [state, setState] = useState<BlockedReasonState>({ status: "idle" });

  useEffect(() => {
    if (!prNumber || runStatus !== "finished") {
      return;
    }

    return watchBlockedReason(repo, prNumber, setState);
  }, [repo, prNumber, runStatus, refreshKey]);

  return prNumber && runStatus === "finished" ? state : { status: "idle" };
}

function watchBlockedReason(
  repo: string,
  prNumber: number,
  onState: (state: BlockedReasonState) => void,
) {
  let stopLoad = loadBlockedReason(repo, prNumber, onState);
  const timer = setInterval(() => {
    stopLoad();
    stopLoad = loadBlockedReason(repo, prNumber, onState);
  }, REFRESH_INTERVAL_MS);

  return () => {
    clearInterval(timer);
    stopLoad();
  };
}

function loadBlockedReason(
  repo: string,
  prNumber: number,
  onState: (state: BlockedReasonState) => void,
) {
  let cancelled = false;
  const apply = (next: BlockedReasonState) => {
    if (!cancelled) {
      onState(next);
    }
  };

  readBlockedReason(repo, prNumber)
    .then(apply)
    .catch(() => apply({ status: "unavailable" }));

  return () => {
    cancelled = true;
  };
}

async function readBlockedReason(
  repo: string,
  prNumber: number,
): Promise<BlockedReasonState> {
  const res = await fetch(
    `/api/repos/${repo}/pulls/${prNumber}/blocked-reason`,
    { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
  );

  if (!res.ok) {
    return { status: "unavailable" };
  }

  const reason = (await res.json()) as BlockedReason;

  return reason.label
    ? { status: "ready", label: reason.label }
    : { status: "idle" };
}
