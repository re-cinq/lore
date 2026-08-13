"use client";

import { useState, useTransition } from "react";
import Icon from "@/components/Icon";

/**
 * Overview-level action: opens a fix-PR installing one workflow on every
 * misaligned repo. Disabled while in flight; reports how many PRs were opened.
 */
export function FixWorkflowButton({
  repos,
  action,
  label,
  title,
}: {
  repos: string[];
  action: (repos: string[]) => Promise<{ opened: number; prs: string[] }>;
  label: string;
  title: string;
}) {
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState<number | null>(null);

  if (repos.length === 0) {
    return null;
  }

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
      title={title}
    >
      {pending ? (
        "opening PRs…"
      ) : done !== null ? (
        `opened ${done} PR${done === 1 ? "" : "s"}`
      ) : (
        <>
          <Icon name="warning" size={13} inline /> {label} ({repos.length})
        </>
      )}
    </button>
  );
}

/** The ingest-workflow instance, kept as its own component for existing callers. */
export default function FixIngestButton(props: {
  repos: string[];
  action: (repos: string[]) => Promise<{ opened: number; prs: string[] }>;
}) {
  return (
    <FixWorkflowButton
      {...props}
      label="Fix ingest workflow"
      title="Open a PR installing the latest .github/workflows/lore-ingest.yml on each flagged repo"
    />
  );
}
