// Pure presentation helpers for the run-keyed assembly-line views — no DB/React, so formatting rules stay unit-testable (precedent: task-presenter.ts).
const EM_DASH = "—";

const RELATIVE_UNITS: { secs: number; name: string; short: string }[] = [
  { secs: 31_536_000, name: "year", short: "y" },
  { secs: 2_592_000, name: "month", short: "mo" },
  { secs: 86_400, name: "day", short: "d" },
  { secs: 3_600, name: "hour", short: "h" },
  { secs: 60, name: "minute", short: "m" },
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

/** An age in its shortest form (`8h`, `30d`), for a figure scanned across a grid. */
export function formatShortAge(
  iso: string,
  nowMs: number = Date.now(),
): string {
  const secs = Math.floor((nowMs - new Date(iso).getTime()) / 1000);
  const unit = RELATIVE_UNITS.find((candidate) => secs >= candidate.secs);

  return unit ? `${Math.floor(secs / unit.secs)}${unit.short}` : "now";
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

/** The run header's status: a run only people hold is open but nothing in it is running, so it says whose move it is; every other run reads by its status and outcome. */
export function runHeaderVisual(
  run: { status: string; outcome: string | null },
  waitingOn: string | null,
): StatusVisual {
  return run.status === "running" && waitingOn
    ? { label: waitingOn, tone: "info" }
    : runStatusVisual(run.status, run.outcome);
}
