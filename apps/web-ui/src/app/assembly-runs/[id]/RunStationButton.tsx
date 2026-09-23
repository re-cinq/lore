"use client";

// "Run this station" (specs/fork-rerun-from-node FR8): any node, any time. Asks first, because a live run is retired to make room; then posts via fetch and navigates to the fresh run. `*Button.tsx` keeps this exempt from no-io-in-view, like RerunNodeButton.
import { useState } from "react";
import { settleStart } from "./settle-start";
import { isTerminalRunStatus } from "@/lib/run-stream-presenter";
import ConfirmDialog, {
  type ConfirmQuestion,
} from "@/components/ConfirmDialog";

/** Whether the run is still open ("live"): the confirmation then says it will be retired. */
export type RunState = "live" | "ended";

export function runStateOf(runStatus: string): RunState {
  return isTerminalRunStatus(runStatus) ? "ended" : "live";
}

interface RunStationButtonProps {
  runId: string;
  nodeId: string;
  runState: RunState;
}

export function RunStationButton(props: RunStationButtonProps) {
  const start = useStationStart(props);

  return (
    <>
      {start.error ? <span className="meta">{start.error}</span> : null}
      <AskButton pending={start.pending} ask={() => start.setAsking(true)} />
      {start.asking && (
        <ConfirmDialog
          question={question(props)}
          pending={start.pending}
          onConfirm={() => void start.confirm()}
          onCancel={() => start.setAsking(false)}
        />
      )}
    </>
  );
}

// The ask, the start and its failure, as one piece of state the button renders.
function useStationStart(props: RunStationButtonProps) {
  const [asking, setAsking] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setPending(true);
    setError(null);
    settleStart(await startStation(props), setError, setPending);
    setAsking(false);
  }

  return { asking, setAsking, pending, error, confirm };
}

// The button sits inside a clickable row; without both, asking would also select the node behind it.
function AskButton({ pending, ask }: { pending: boolean; ask: () => void }) {
  return (
    <button
      type="button"
      disabled={pending}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        ask();
      }}
    >
      {pending ? "Starting…" : "Run this station"}
    </button>
  );
}

const RETIRED =
  "This run is still open; it is retired and a fresh run starts at";

function question({
  nodeId,
  runState,
}: RunStationButtonProps): ConfirmQuestion {
  const starts = `${nodeId} on the same branch, with this run's arguments.`;

  return {
    title: `Run ${nodeId} now?`,
    body:
      runState === "live"
        ? `${RETIRED} ${starts}`
        : `A fresh run starts at ${starts}`,
    confirmLabel: "Run",
    tone: runState === "live" ? "danger" : "accent",
  };
}

/** Starts the station and navigates to the fresh run, or returns the message to show. Nothing is returned on success because the page is already leaving. */
async function startStation({
  runId,
  nodeId,
}: RunStationButtonProps): Promise<string | null> {
  try {
    const res = await fetch("/api/assembly-runs/run-station", {
      method: "POST",
      signal: AbortSignal.timeout(30_000),
      body: new URLSearchParams({ run_id: runId, node_id: nodeId }),
    });
    const body = (await res.json()) as { id?: string; error?: string };

    if (!res.ok || !body.id) {
      return body.error ?? `run failed (${res.status})`;
    }
    window.location.assign(`/assembly-runs/${body.id}`);

    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}
