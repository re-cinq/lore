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
import { MAX_TURNS_LOADED } from "./turn-transcript-presenter";

type TurnsSetter = Dispatch<SetStateAction<AgentRunTurn[] | null>>;

interface TailCursor {
  newest: string;
  held: number;
  pulling: boolean;
  queued: boolean;
}

export interface TailWiring {
  runId: string;
  disposedRef: { current: boolean };
  setTurns: TurnsSetter;
  setCapped: (capped: boolean) => void;
}

interface TailSink {
  isDisposed: () => boolean;
  append: (fresh: AgentRunTurn[]) => void;
  cap: () => void;
}

/** `seed` takes the full walk's turns and remembers the newest; `follow` appends whatever was stored after it. */
export function useTranscriptTail(wiring: TailWiring) {
  const { runId, disposedRef, setTurns, setCapped } = wiring;
  const cursorRef = useRef<TailCursor>(idleCursor());
  const seed = useCallback(
    (loaded: AgentRunTurn[]) => {
      cursorRef.current.newest = newestId(loaded, "0");
      cursorRef.current.held = loaded.length;
      setTurns(loaded);
    },
    [setTurns],
  );
  const follow = useCallback(() => {
    const sink = tailSink({ disposedRef, setTurns, setCapped });

    void followTail(runId, cursorRef.current, sink);
  }, [runId, disposedRef, setTurns, setCapped]);

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

    if (!keepWithinCap(cursor, fresh, sink)) {
      return;
    }
  } while (takeQueued(cursor));
}

/** Appends what still fits under the load cap the first walk honors; false once the cap is reached, which ends the following and raises the cap notice. */
function keepWithinCap(
  cursor: TailCursor,
  fresh: { turns: AgentRunTurn[]; hitCap: boolean },
  sink: TailSink,
): boolean {
  const kept = fresh.turns.slice(0, MAX_TURNS_LOADED - cursor.held);

  cursor.newest = newestId(kept, cursor.newest);
  cursor.held += kept.length;

  if (kept.length > 0) {
    sink.append(kept);
  }
  const capped = fresh.hitCap || cursor.held >= MAX_TURNS_LOADED;

  if (capped) {
    sink.cap();
  }

  return !capped;
}

function tailSink({
  disposedRef,
  setTurns,
  setCapped,
}: Omit<TailWiring, "runId">): TailSink {
  return {
    isDisposed: () => disposedRef.current,
    append: (fresh) => setTurns((held) => [...(held ?? []), ...fresh]),
    cap: () => setCapped(true),
  };
}

function idleCursor(): TailCursor {
  return { newest: "0", held: 0, pulling: false, queued: false };
}

function takeQueued(cursor: TailCursor): boolean {
  const queued = cursor.queued;

  cursor.queued = false;

  return queued;
}

function newestId(turns: readonly AgentRunTurn[], fallback: string): string {
  return turns.at(-1)?.id ?? fallback;
}
