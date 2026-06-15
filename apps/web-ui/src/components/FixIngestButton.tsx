'use client';

import { useState, useTransition } from 'react';

/**
 * Overview-level action: opens a fix-PR installing the ingest workflow on
 * every misaligned repo. Disabled while in flight; reports how many PRs
 * were opened.
 */
export default function FixIngestButton({
  repos,
  action,
}: {
  repos: string[];
  action: (repos: string[]) => Promise<{ opened: number; prs: string[] }>;
}) {
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState<number | null>(null);

  if (repos.length === 0) return null;

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const { opened } = await action(repos);
          setDone(opened);
        })
      }
      title="Open a PR installing the latest .github/workflows/lore-ingest.yml on each flagged repo"
    >
      {pending
        ? 'opening PRs…'
        : done !== null
          ? `opened ${done} PR${done === 1 ? '' : 's'}`
          : `⚠ Fix ingest workflow (${repos.length})`}
    </button>
  );
}
