"use client";

import { useState } from "react";
import Icon from "@/components/Icon";
import PendingActionButton from "@/components/PendingActionButton";
import type { FixWorkflowResult } from "@/lib/fix-workflow-result";

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

interface FixWorkflowButtonProps {
  repos: string[];
  action: (repos: string[]) => Promise<FixWorkflowResult>;
  label: string;
  title: string;
}

/** Reports how many PRs opened and, critically, why any repo failed — "opened 0 PRs" with no reason is how a missing App permission stayed invisible. */
export function FixWorkflowButton(props: FixWorkflowButtonProps) {
  const { repos, action, label, title } = props;
  const [done, setDone] = useState<FixWorkflowResult | null>(null);

  // Nothing to fix is not a disabled button: an always-present control invites a click that can do nothing.
  if (repos.length === 0) {
    return null;
  }

  return (
    <PendingActionButton
      action={() => runFix(repos, action, setDone)}
      text={readyLabel({ done, label, count: repos.length })}
      pendingText="opening PRs…"
      title={failureTitle(done) ?? title}
      className=""
    />
  );
}

async function runFix(
  repos: string[],
  action: FixWorkflowButtonProps["action"],
  setDone: (done: FixWorkflowResult) => void,
): Promise<void> {
  setDone(await action(repos));
}

interface ReadyLabelProps {
  done: FixWorkflowResult | null;
  label: string;
  count: number;
}

/** What the button says once it isn't running: the outcome if there is one, the invitation otherwise. The outcome keeps the failure count beside the success count, so a partial run does not read as a clean one. */
function readyLabel({ done, label, count }: ReadyLabelProps) {
  if (done !== null) {
    const opened = `opened ${done.opened} PR${done.opened === 1 ? "" : "s"}`;

    return done.failed.length === 0
      ? opened
      : `${opened}, ${done.failed.length} failed`;
  }

  return (
    <>
      <Icon name="warning" size={13} inline /> {label} ({count})
    </>
  );
}

/** Per-repo failures as a tooltip, or null when the run had none. The repo name rides with each message because one click covers many repos, and "failed" without saying which is not actionable. */
function failureTitle(done: FixWorkflowResult | null): string | null {
  if (!done || done.failed.length === 0) {
    return null;
  }

  const { failed } = done;

  return failed.map((f) => `${f.repo}: ${f.error}`).join("\n");
}
