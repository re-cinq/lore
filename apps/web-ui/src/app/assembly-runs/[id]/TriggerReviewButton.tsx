"use client";

// Manual "Trigger review" — UI twin of an `@lore review` comment; native form POST to /api/review/trigger, then redirect back.
export function TriggerReviewButton({
  repo,
  prNumber,
}: {
  repo: string;
  prNumber: number;
}) {
  return (
    <form action="/api/review/trigger" method="POST">
      <input type="hidden" name="repo" value={repo} />
      <input type="hidden" name="pr_number" value={prNumber} />
      {/* eslint-disable-next-line no-restricted-syntax -- native full-page POST, no client JS state to show; the browser's own navigation is the pending affordance */}
      <button type="submit">Trigger review</button>
    </form>
  );
}
