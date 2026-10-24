"use client";

import { useEffect, useState } from "react";
import type { ImplementationLoop } from "@/lib/api/backlog";
import type { RepoLoop } from "@/lib/api/loops";
import OnboardingBanner from "../implementation/OnboardingBanner";
import LoopRunsFollower from "../LoopRunsFollower";
import { loopBoard, type LoopRead } from "./board";
import BoardView from "./BoardView";
import { loadMoreOf, type Paging } from "./section-limits";
import styles from "./BoardView.module.scss";

/** One loop's read as it reaches the browser; the implementation loop's carries its raw read for the onboarding banner. */
export type StreamedRead = LoopRead & { implementation?: ImplementationLoop };

interface StreamingBoardProps {
  loops: readonly RepoLoop[];
  /** One read per loop, in the loops' order, each arriving on its own. */
  reads: readonly Promise<StreamedRead>[];
  paging: Paging;
  subject: string;
  retry: () => Promise<void>;
}

/** The board drawn from whichever loops have answered: each loop's rows join it as they arrive, the loops still loading are named above it and in every empty section, and a refresh keeps a loop's rows until its new ones land. */
export default function StreamingBoard(props: StreamingBoardProps) {
  const { shown, loading } = useArrivedReads(props.loops, props.reads);
  const board = loopBoard(shown, props.paging.limits, loading);

  return (
    <>
      <LoopRunsFollower runIds={board.runIds} />
      <LoadingLoops loops={loading} />
      <ImplementationBanner reads={shown} retry={props.retry} />
      <BoardView
        board={board}
        subject={props.subject}
        showLoop={props.loops.length > 1}
        loadMore={loadMoreOf(props.paging)}
      />
    </>
  );
}

/** Why an enabled implementation loop picks nothing, once its read has arrived and its onboarding has not merged. */
function ImplementationBanner({
  reads,
  retry,
}: {
  reads: readonly StreamedRead[];
  retry: () => Promise<void>;
}) {
  const implementation = reads.find(
    (read) => read.implementation,
  )?.implementation;

  return implementation ? (
    <OnboardingBanner loop={implementation} retry={retry} />
  ) : null;
}

interface Arrived {
  read: StreamedRead;
  /** The read it came from: a newer one for the loop means it is loading again. */
  from: Promise<StreamedRead>;
}

type ArrivedByLoop = Partial<Record<string, Arrived>>;

/** Each loop's newest arrived read, and the loops whose current read has not arrived. */
function useArrivedReads(
  loops: readonly RepoLoop[],
  reads: readonly Promise<StreamedRead>[],
) {
  const [arrived, setArrived] = useState<ArrivedByLoop>({});

  useEffect(
    () =>
      followReads(loops, reads, (key, entry) => {
        setArrived((earlier) => ({ ...earlier, [key]: entry }));
      }),
    [loops, reads],
  );

  return {
    shown: loops.flatMap((loop) => arrived[loop.key]?.read ?? []),
    loading: loops.filter((loop, at) => arrived[loop.key]?.from !== reads[at]),
  };
}

/** Hands each read to `arrive` as it lands, until the returned stop is called: a newer render's reads replace these. */
function followReads(
  loops: readonly RepoLoop[],
  reads: readonly Promise<StreamedRead>[],
  arrive: (key: string, entry: Arrived) => void,
): () => void {
  let live = true;

  reads.forEach((from, at) => {
    void from.then((read) => live && arrive(loops[at].key, { read, from }));
  });

  return () => {
    live = false;
  };
}

/** A spinner per loop whose rows are on their way. */
function LoadingLoops({ loops }: { loops: readonly RepoLoop[] }) {
  if (loops.length === 0) {
    return null;
  }

  return (
    <div className={styles.loadingLoops} data-testid="loops-loading">
      {loops.map((loop) => (
        <span key={loop.key} className={`meta ${styles.loadingLoop}`}>
          <span className="chip-spinner" role="status" aria-label="Loading" />
          {loop.label}
        </span>
      ))}
    </div>
  );
}
