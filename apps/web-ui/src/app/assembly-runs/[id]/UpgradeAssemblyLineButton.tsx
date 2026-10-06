"use client";

export function UpgradeAssemblyLineButton({ runId }: { runId: string }) {
  return (
    <form
      action={`/api/assembly-runs/${encodeURIComponent(runId)}/upgrade`}
      method="POST"
    >
      <button type="submit">Upgrade assembly line</button>
    </form>
  );
}
