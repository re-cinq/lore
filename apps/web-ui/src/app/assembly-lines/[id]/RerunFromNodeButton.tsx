"use client";

import { useState } from "react";

/**
 * "Rerun from here" — forks the run from one completed node
 * (specs/fork-rerun-from-node FR6) via the /api/assembly-lines/[id]/rerun
 * proxy. Client-side submit rather than a native form POST so a refusal (the
 * drift guard's "definition hash mismatch", a 403) renders inline next to the
 * button instead of navigating the operator to a raw JSON document, and so
 * the button disables while a fork is in flight — a double-click would start
 * two forks racing the same branch. On success, navigates to the fork's run
 * page. A `*Button.tsx` name keeps it exempt from `no-io-in-view`.
 */
export function RerunFromNodeButton({
  runId,
  nodeId,
}: {
  runId: string;
  nodeId: string;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function rerun() {
    setPending(true);
    setError(null);

    try {
      const form = new FormData();

      form.set("node_id", nodeId);
      const res = await fetch(`/api/assembly-lines/${runId}/rerun`, {
        method: "POST",
        body: form,
      });
      const body = (await res.json()) as { started?: string; error?: string };

      if (!res.ok || !body.started) {
        setError(body.error ?? `Rerun failed (${res.status})`);
        setPending(false);

        return;
      }

      // Full navigation, not a router push: the fork is a brand-new page whose
      // RSC payload must be fetched fresh anyway, and it keeps this component
      // renderable without a mounted app router.
      window.location.assign(`/assembly-lines/${body.started}`);
    } catch {
      setError("Rerun failed — network error");
      setPending(false);
    }
  }

  return (
    <span>
      <button type="button" disabled={pending} onClick={() => void rerun()}>
        {pending ? "Starting…" : "Rerun from here"}
      </button>
      {error ? <span role="alert">{error}</span> : null}
    </span>
  );
}
