"use client";

// The live end of a run's transcript: after the one full walk, each live event pulls only the turns stored since the newest one held.
import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { AgentRunTurn } from "@/lib/run-turn-types";
import { walkTurns } from "./transcript-walk";

type TurnsSetter = Dispatch<SetStateAction<AgentRunTurn[] | null>>;

interface TailCursor {
  newest: string;
  pulling: boolean;
  queued: boolean;
}

export interface TailWiring {
  runId: string;
  disposedRef: { current: boolean };
  setTurns: TurnsSetter;
}

interface TailSink {
  isDisposed: () => boolean;
  append: (fresh: AgentRunTurn[]) => void;
}

/** `seed` takes the full walk's turns and remembers the newest; `follow` appends whatever was stored after it. */
export function useTranscriptTail({
  runId,
  disposedRef,
  setTurns,
}: TailWiring) {
  const cursorRef = useRef<TailCursor>(idleCursor());
  const seed = useCallback(
    (loaded: AgentRunTurn[]) => {
      cursorRef.current.newest = newestId(loaded, "0");
      setTurns(loaded);
    },
    [setTurns],
  );
  const follow = useCallback(() => {
    void followTail(runId, cursorRef.current, tailSink(disposedRef, setTurns));
  }, [runId, disposedRef, setTurns]);

  return { seed, follow };
}

/** Follows every live event; undefined while there is no loaded, uncapped transcript to extend. */
export function useFollowLiveEvents(
  liveEventId: string | undefined,
  follow: () => void,
): void {
  useEffect(() => {
    if (liveEventId !== undefined) {
      follow();
    }
  }, [liveEventId, follow]);
}

/** One pull at a time: an event arriving mid-pull queues exactly one more rather than a concurrent pull, so no turn is appended twice. */
async function followTail(runId: string, cursor: TailCursor, sink: TailSink) {
  if (cursor.pulling) {
    cursor.queued = true;

    return;
  }
  cursor.pulling = true;
  cursor.queued = false;
  await pullUntilSettled(runId, cursor, sink).finally(() => {
    cursor.pulling = false;
  });
}

/** A failed pull is dropped rather than shown: the turns on screen are still true, and the next event retries from the same cursor. */
async function pullUntilSettled(
  runId: string,
  cursor: TailCursor,
  sink: TailSink,
): Promise<void> {
  do {
    const fresh = await walkTurns(runId, {
      after: cursor.newest,
      isDisposed: sink.isDisposed,
    }).catch(() => null);

    if (fresh === null || sink.isDisposed()) {
      return;
    }
    cursor.newest = newestId(fresh.turns, cursor.newest);
    sink.append(fresh.turns);
  } while (takeQueued(cursor));
}

function tailSink(
  disposedRef: { current: boolean },
  setTurns: TurnsSetter,
): TailSink {
  return {
    isDisposed: () => disposedRef.current,
    append: (fresh) => setTurns((held) => [...(held ?? []), ...fresh]),
  };
}

function idleCursor(): TailCursor {
  return { newest: "0", pulling: false, queued: false };
}

function takeQueued(cursor: TailCursor): boolean {
  const queued = cursor.queued;

  cursor.queued = false;

  return queued;
}

function newestId(turns: readonly AgentRunTurn[], fallback: string): string {
  return turns.at(-1)?.id ?? fallback;
}
