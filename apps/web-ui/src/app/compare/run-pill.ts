import type { StatusTone } from "@/components/StatusPill";
import {
  runStatusVisual,
  type StatusTone as RunTone,
} from "@/lib/assembly-run-presenter";
import type { AssemblyRun } from "@/lib/assembly-run-rows";

// A run's status as a pill: the run list's label, in the pill's tone vocabulary.

const PILL_TONE: Record<RunTone, StatusTone> = {
  success: "ok",
  danger: "err",
  warning: "warn",
  info: "running",
  running: "running",
  muted: "idle",
};

export function runPill(run: Pick<AssemblyRun, "status" | "outcome">): {
  label: string;
  tone: StatusTone;
} {
  const visual = runStatusVisual(run.status, run.outcome);

  return { label: visual.label, tone: PILL_TONE[visual.tone] };
}
