"use client";

import { useState, useTransition } from "react";
import Icon from "@/components/Icon";
import type { FixWorkflowResult } from "@/lib/fix-workflow-result";

interface ButtonTextProps {
  pending: boolean;
  done: FixWorkflowResult | null;
  label: string;
  count: number;
}

/** What the button says, in the order the states actually occur: working, then the outcome, then the invitation. The outcome keeps the failure count beside the success count, so a partial run does not read as a clean one. */
function buttonText({ pending, done, label, count }: ButtonTextProps) {
  if (pending) {
    return "opening PRs…";
  }

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

interface FixWorkflowButtonProps {
  repos: string[];
  action: (repos: string[]) => Promise<FixWorkflowResult>;
  label: string;
  title: string;
}

/** Per-repo failures as a tooltip, or null when the run had none. The repo name rides with each message because one click covers many repos, and "failed" without saying which is not actionable. */
function failureTitle(done: FixWorkflowResult | null): string | null {
  if (!done || done.failed.length === 0) {
    return null;
  }

  const { failed } = done;

  return failed.map((f) => `${f.repo}: ${f.error}`).join("\n");
}

/** The run itself: one transition covering every repo, whose result is kept so the button can report it. */
function useFixWorkflow(
  repos: string[],
  action: FixWorkflowButtonProps["action"],
) {
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState<FixWorkflowResult | null>(null);
  const openPrs = () =>
    startTransition(async () => {
      setDone(await action(repos));
    });

  return { pending, done, openPrs };
}

/** Reports how many PRs opened and, critically, why any repo failed — "opened 0 PRs" with no reason is how a missing App permission stayed invisible. */
export function FixWorkflowButton(props: FixWorkflowButtonProps) {
  const { repos, action, label, title } = props;
  const { pending, done, openPrs } = useFixWorkflow(repos, action);

  // Nothing to fix is not a disabled button: an always-present control invites a click that can do nothing.
  if (repos.length === 0) {
    return null;
  }

  return (
    <button
      type="button"
      disabled={pending}
      onClick={openPrs}
      title={failureTitle(done) ?? title}
    >
      {buttonText({ pending, done, label, count: repos.length })}
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
