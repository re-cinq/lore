"use client";

// "Retry from this node" (specs/fork-rerun-from-node): posts via fetch (a native form POST navigated the whole page into a bare JSON screen) and navigates to the new run on success; `*Button.tsx` name keeps this exempt from no-io-in-view.
import { useState } from "react";

export function RerunNodeButton({
  runId,
  resumeNodeId,
  resumeIteration,
}: {
  runId: string;
  resumeNodeId: string;
  resumeIteration: number;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function rerun(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    setPending(true);
    setError(null);

    try {
      const res = await fetch("/api/assembly-runs/rerun", {
        method: "POST",
        signal: AbortSignal.timeout(15_000),
        body: new URLSearchParams({
          run_id: runId,
          node_id: resumeNodeId,
          iteration: String(resumeIteration),
        }),
      });
      const data = (await res.json()) as { id?: string; error?: string };

      if (!res.ok || !data.id) {
        setError(data.error ?? `retry failed (${res.status})`);
        setPending(false);

        return;
      }
      window.location.assign(`/assembly-runs/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPending(false);
    }
  }

  return (
    <>
      {error ? <span className="meta">{error}</span> : null}
      <button
        type="button"
        onClick={(event) => void rerun(event)}
        disabled={pending}
      >
        {pending ? "Starting retry…" : "Retry from this node"}
      </button>
    </>
  );
}
