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
      <button type="submit">Trigger review</button>
    </form>
  );
}
