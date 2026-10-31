"use client";

import Link from "next/link";
import { useState } from "react";
import PendingActionButton from "@/components/PendingActionButton";
import { TimeAgo } from "@/components/TimeAgo";
import type { LoopPause } from "@/lib/api/loops";
import styles from "./LoopPaused.module.scss";

interface LoopPausedProps {
  pause: LoopPause;
  /** Answers why the resume was refused, or null. */
  resume: () => Promise<string | null>;
}

/** Why the loop is held, since when and until when, the run that paused it, and the one control that lets it go on (specs/loop-pause FR5). */
export default function LoopPaused({ pause, resume }: LoopPausedProps) {
  return (
    <div role="status" className={styles.paused}>
      <PauseText pause={pause} />
      <ResumeButton resume={resume} />
    </div>
  );
}

function PauseText({ pause }: { pause: LoopPause }) {
  return (
    <span>
      Paused: {pause.reason} · since <TimeAgo date={pause.at} inline />
      {pause.until && <Until date={pause.until} />}
      {pause.run_id && <PausingRun runId={pause.run_id} />}
    </span>
  );
}

/** A plain date: the relative half of TimeAgo reads any time to come as "just now". */
function Until({ date }: { date: string }) {
  return (
    <>
      {" "}
      · until{" "}
      <time dateTime={date} suppressHydrationWarning>
        {new Date(date).toLocaleString()}
      </time>
    </>
  );
}

function PausingRun({ runId }: { runId: string }) {
  return (
    <>
      {" "}
      · <Link href={`/assembly-runs/${runId}`}>the run that paused it</Link>
    </>
  );
}

/** Resume, with a spinner until the refreshed page drops the notice, and why a refused resume was refused. */
function ResumeButton({ resume }: Pick<LoopPausedProps, "resume">) {
  const [refusal, setRefusal] = useState<string | null>(null);

  async function onResume() {
    setRefusal(await resume().catch(() => "Could not resume it; try again."));
  }

  return (
    <>
      <PendingActionButton
        action={onResume}
        text="Resume"
        pendingText="Resuming…"
        className={styles.resume}
      />
      {refusal && <Refusal reason={refusal} />}
    </>
  );
}

function Refusal({ reason }: { reason: string }) {
  return (
    <span role="alert" className={styles.failed}>
      {reason}
    </span>
  );
}
