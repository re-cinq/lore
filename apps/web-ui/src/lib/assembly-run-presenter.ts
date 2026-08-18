// Pure presentation helpers for the run-keyed assembly-line views. No DB or
// React here so the formatting rules stay unit-testable in isolation (precedent:
// task-presenter.ts). Re-homed from the retired task-chain grouping lib.

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

/** Map the run vocabulary (queued/running/finished/failed × outcome) to a
 *  display label + tone. `finished` is refined by the run's outcome. */
export function runStatusVisual(
  status: string,
  outcome: string | null,
): { label: string; tone: StatusTone } {
  if (status === "queued") {
    return { label: "Queued", tone: "muted" };
  }

  if (status === "running") {
    return { label: "Running", tone: "running" };
  }

  if (status === "failed") {
    return { label: "Failed", tone: "danger" };
  }

  // status === "finished" — the outcome carries the real verdict. A `finished`
  // row can still be a FAILURE: the pg adapter maps only outcome `error` to
  // status `failed`, so a single-CR task closed `failed`/`needs-human-help` and a
  // code-review line closed `pr_closed` both land here with a non-error outcome.
  switch (outcome) {
    case "pr_created":
      return { label: "PR created", tone: "success" };
    case "completed":
      return { label: "Completed", tone: "success" };
    case "failed":
      return { label: "Failed", tone: "danger" };
    case "no_changes":
      return { label: "No changes", tone: "muted" };
    case "pr_closed":
      return { label: "PR closed", tone: "muted" };
    case "lease_held":
      return { label: "Skipped", tone: "muted" };
    case "iteration_max":
      return { label: "Iteration max", tone: "warning" };
    case "pending":
      return { label: "Pending", tone: "info" };
    default:
      // Unknown/future outcome must never masquerade as success — stay neutral.
      return { label: outcome ?? "Finished", tone: "muted" };
  }
}
