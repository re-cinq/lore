"use client";

import Link from "next/link";
import { useState } from "react";
import Icon from "@/components/Icon";
import PendingActionButton from "@/components/PendingActionButton";
import type { SetupOutcome } from "@/lib/update-setup-result";
import styles from "./UpdateSetupButton.module.css";

interface UpdateSetupButtonProps {
  repos: string[];
  action: (repos: string[]) => Promise<SetupOutcome[]>;
}

const TITLE =
  "Re-onboard each flagged repo: rewrites its LORE_INGEST_URL variable and LORE_INGEST_TOKEN secret, opens a PR only for Lore files that differ, and starts the first ingestion";

/** Re-onboards every flagged repo and says per repo what happened. A refusal keeps its repo and reason: "0 started" with no reason is how a missing App permission stayed invisible. */
export default function UpdateSetupButton(props: UpdateSetupButtonProps) {
  const { repos, action } = props;
  const [outcomes, setOutcomes] = useState<SetupOutcome[] | null>(null);

  // Nothing to update is not a disabled button: an always-present control invites a click that can do nothing.
  if (repos.length === 0) {
    return null;
  }

  return (
    <div className={styles.wrapper}>
      <PendingActionButton
        action={async () => setOutcomes(await action(repos))}
        text={readyLabel(outcomes, repos.length)}
        pendingText="starting runs…"
        title={refusalTitle(outcomes) ?? TITLE}
        className=""
      />
      {outcomes && <OutcomeList outcomes={outcomes} />}
    </div>
  );
}

/** The outcome once the click has run, the invitation before. The refusal count rides beside the started count, so a partial run does not read as a clean one. */
function readyLabel(outcomes: SetupOutcome[] | null, count: number) {
  if (outcomes === null) {
    return (
      <>
        <Icon name="warning" size={13} inline /> Update setup ({count})
      </>
    );
  }

  const started = outcomes.filter((o) => o.status !== "refused").length;
  const refused = outcomes.length - started;

  return refused === 0
    ? `started ${started}`
    : `started ${started}, ${refused} refused`;
}

/** Per-repo refusals as a tooltip, or null when none. The repo name rides with each reason because one click covers many repos. */
function refusalTitle(outcomes: SetupOutcome[] | null): string | null {
  const refusals = (outcomes ?? []).filter((o) => o.status === "refused");

  return refusals.length === 0
    ? null
    : refusals.map((o) => `${o.repo}: ${o.reason}`).join("\n");
}

function OutcomeList({ outcomes }: { outcomes: SetupOutcome[] }) {
  return (
    <ul className={styles.outcomes}>
      {outcomes.map((outcome) => (
        <li key={outcome.repo}>
          <OutcomeLine outcome={outcome} />
        </li>
      ))}
    </ul>
  );
}

function OutcomeLine({ outcome }: { outcome: SetupOutcome }) {
  if (outcome.status === "refused") {
    return `${outcome.repo}: refused, ${outcome.reason}`;
  }

  const state = outcome.status === "started" ? "started" : "already running";

  return (
    <Link href={`/assembly-runs/${outcome.taskId}`}>
      {outcome.repo}: {state}
    </Link>
  );
}
