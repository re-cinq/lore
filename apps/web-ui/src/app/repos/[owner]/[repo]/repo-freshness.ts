import { formatRelativeTime } from "@/lib/assembly-run-presenter";

const HOUR_MS = 60 * 60 * 1000;

/** How recently a repo was ingested, as a colour and its meaning. Shared by the repo cards and the repo header, so both read the same thresholds. */
export function freshnessIndicator(lastIngestedAt: string | null): {
  color: string;
  label: string;
} {
  if (!lastIngestedAt) {
    return { color: "var(--text-muted)", label: "Never ingested" };
  }
  const hoursAgo = (Date.now() - new Date(lastIngestedAt).getTime()) / HOUR_MS;

  if (hoursAgo < 24) {
    return { color: "var(--success)", label: "Fresh (< 24h)" };
  }

  if (hoursAgo < 7 * 24) {
    return { color: "var(--warning)", label: "Stale (< 7d)" };
  }

  return { color: "var(--danger)", label: "Outdated (> 7d)" };
}

/** The ingest age in words ("3 hours ago"), or "Never". */
export function ingestAge(lastIngestedAt: string | null): string {
  return lastIngestedAt ? formatRelativeTime(lastIngestedAt) : "Never";
}
