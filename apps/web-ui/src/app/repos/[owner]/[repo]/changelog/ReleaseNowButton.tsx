"use client";

import Link from "next/link";
import { useState } from "react";
import LinkPending from "@/components/LinkPending";
import PendingActionButton from "@/components/PendingActionButton";
import styles from "./ChangelogView.module.scss";
import type { ReleaseNow, ReleaseNowResult } from "./release-now-outcome";

interface ReleaseNowButtonProps {
  /** How many changes merged and closed since the latest release; null when the page does not know. */
  unreleased: number | null;
  latestVersion: string | null;
  releaseNow: ReleaseNow;
}

/** Starts a release for the repository's current head, with no schedule needed, and links to the run once it started. */
export default function ReleaseNowButton(props: ReleaseNowButtonProps) {
  const [result, setResult] = useState<ReleaseNowResult | null>(null);

  if (result?.ok) {
    return <Started runId={result.runId} joined={result.joined} />;
  }

  return (
    <div className={styles.releaseNow}>
      <Press {...props} onResult={setResult} />
      {result && (
        <p role="alert" className={styles.refusal}>
          {result.said}
        </p>
      )}
    </div>
  );
}

function Press(
  props: ReleaseNowButtonProps & {
    onResult: (result: ReleaseNowResult) => void;
  },
) {
  if (props.unreleased === 0) {
    return <NothingToRelease latestVersion={props.latestVersion} />;
  }

  return (
    <>
      <PendingActionButton
        action={async () => props.onResult(await props.releaseNow())}
        text="Release now"
        pendingText="Starting the release…"
        className={styles.releaseButton}
      />
      {props.unreleased !== null && <Count unreleased={props.unreleased} />}
    </>
  );
}

function NothingToRelease({ latestVersion }: { latestVersion: string | null }) {
  return (
    <button type="button" disabled className={styles.releaseButton}>
      {latestVersion
        ? `Nothing merged since ${latestVersion}`
        : "Nothing merged yet"}
    </button>
  );
}

function Count({ unreleased }: { unreleased: number }) {
  return (
    <span className={styles.meta}>
      {unreleased} {unreleased === 1 ? "change" : "changes"} unreleased
    </span>
  );
}

function Started({ runId, joined }: { runId: string; joined: boolean }) {
  return (
    <p className={styles.note}>
      {joined
        ? "A release run is already open for this commit: "
        : "Release started: "}
      <Link href={`/assembly-runs/${runId}`}>
        Open the run
        <LinkPending label="Opening the run" />
      </Link>
    </p>
  );
}
