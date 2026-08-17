"use client";

/**
 * Manual "Trigger review" — the UI twin of an `@lore review` comment. A native
 * form POST to the /api/review/trigger proxy (which forwards to the Floor), then
 * a redirect back. A `*Button.tsx` name keeps it exempt from `no-io-in-view`.
 */
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
