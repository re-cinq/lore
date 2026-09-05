// Pure presentation helpers for the run-keyed assembly-line views — no DB/React, so formatting rules stay unit-testable (precedent: task-presenter.ts).
const EM_DASH = "—";

const RELATIVE_UNITS: { secs: number; name: string }[] = [
  { secs: 31_536_000, name: "year" },
  { secs: 2_592_000, name: "month" },
  { secs: 86_400, name: "day" },
  { secs: 3_600, name: "hour" },
  { secs: 60, name: "minute" },
];

export function formatRelativeTime(
  iso: string,
  nowMs: number = Date.now(),
): string {
  const secs = Math.floor((nowMs - new Date(iso).getTime()) / 1000);

  for (const unit of RELATIVE_UNITS) {
    const value = Math.floor(secs / unit.secs);

    if (value >= 1) {
      return `${value} ${unit.name}${value === 1 ? "" : "s"} ago`;
    }
  }

  return "just now";
}

/** A finished-run duration in `42s` / `11m 55s` form; em-dash when unknown. */
export function formatDuration(seconds: number | null): string {
  if (seconds === null) {
    return EM_DASH;
  }

  return seconds >= 60
    ? `${Math.floor(seconds / 60)}m ${seconds % 60}s`
    : `${seconds}s`;
}

export type StatusTone =
  "success" | "danger" | "warning" | "info" | "running" | "muted";

type StatusVisual = { label: string; tone: StatusTone };

const STATUS_VISUALS: Partial<Record<string, StatusVisual>> = {
  queued: { label: "Queued", tone: "muted" },
  running: { label: "Running", tone: "running" },
  failed: { label: "Failed", tone: "danger" },
};

// status === "finished" carries the real verdict in outcome — the pg adapter maps only outcome `error` to status `failed`.
const OUTCOME_VISUALS: Partial<Record<string, StatusVisual>> = {
  pr_created: { label: "PR created", tone: "success" },
  completed: { label: "Completed", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  no_changes: { label: "No changes", tone: "muted" },
  pr_closed: { label: "PR closed", tone: "muted" },
  lease_held: { label: "Skipped", tone: "muted" },
  iteration_max: { label: "Iteration max", tone: "warning" },
  pending: { label: "Pending", tone: "info" },
};

/** Maps the run vocabulary (queued/running/finished/failed × outcome) to a display label + tone; `finished` is refined by outcome. */
export function runStatusVisual(
  status: string,
  outcome: string | null,
): StatusVisual {
  const known = STATUS_VISUALS[status];

  if (known) {
    return known;
  }

  // Unknown/future outcome must never masquerade as success — stay neutral.
  return (
    (outcome ? OUTCOME_VISUALS[outcome] : undefined) ?? {
      label: outcome ?? "Finished",
      tone: "muted",
    }
  );
}
