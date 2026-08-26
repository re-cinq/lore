"use client";

import { useState, useTransition } from "react";
import Icon from "@/components/Icon";
import type { FixWorkflowResult } from "@/lib/fix-workflow-result";

/**
 * Overview-level action: opens a fix-PR installing one workflow on every
 * misaligned repo. Disabled while in flight; reports how many PRs were opened
 * and — critically — how many repos failed and why. "opened 0 PRs" with no
 * reason is exactly how a missing App permission stayed invisible.
 */
export function FixWorkflowButton({
  repos,
  action,
  label,
  title,
}: {
  repos: string[];
  action: (repos: string[]) => Promise<FixWorkflowResult>;
  label: string;
  title: string;
}) {
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState<FixWorkflowResult | null>(null);

  if (repos.length === 0) {
    return null;
  }

  const doneLabel = (result: FixWorkflowResult) => {
    const opened = `opened ${result.opened} PR${result.opened === 1 ? "" : "s"}`;

    return result.failed.length === 0
      ? opened
      : `${opened}, ${result.failed.length} failed`;
  };

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          setDone(await action(repos));
        })
      }
      title={
        done && done.failed.length > 0
          ? done.failed.map((f) => `${f.repo}: ${f.error}`).join("\n")
          : title
      }
    >
      {pending ? (
        "opening PRs…"
      ) : done !== null ? (
        doneLabel(done)
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
  action: (repos: string[]) => Promise<FixWorkflowResult>;
}) {
  return (
    <FixWorkflowButton
      {...props}
      label="Fix ingest workflow"
      title="Open a PR installing the latest .github/workflows/lore-ingest.yml on each flagged repo"
    />
  );
}
