"use client";

import { useEffect, useState } from "react";

interface BlockedReason {
  label: string;
}

export interface BlockedReasonBannerProps {
  repo: string;
  prNumber: number | null;
  runStatus: string;
}

const REQUEST_TIMEOUT_MS = 15_000;

export default function BlockedReasonBanner({
  repo,
  prNumber,
  runStatus,
}: BlockedReasonBannerProps) {
  const reason = useBlockedReason(repo, prNumber, runStatus);

  if (!reason) {
    return null;
  }

  return <p>{reason.label}</p>;
}

function useBlockedReason(
  repo: string,
  prNumber: number | null,
  runStatus: string,
): BlockedReason | null {
  const [reason, setReason] = useState<BlockedReason | null>(null);

  useEffect(() => {
    if (runStatus !== "settled" || prNumber === null) {return;}

    let disposed = false;

    readBlockedReason(repo, prNumber)
      .then((next) => {
        if (!disposed && next !== null) {setReason(next);}
      })
      .catch(() => {});

    return () => {
      disposed = true;
    };
  }, [repo, prNumber, runStatus]);

  return reason;
}

async function readBlockedReason(
  repo: string,
  prNumber: number,
): Promise<BlockedReason | null> {
  const res = await fetch(
    `/api/repos/${repo}/pulls/${prNumber}/blocked-reason`,
    { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
  );

  if (!res.ok) {
    return null;
  }

  return (await res.json()) as BlockedReason;
}
