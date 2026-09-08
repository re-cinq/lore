"use client";

// On-demand full-fidelity transcript (specs/turn-level-transcript-store #1148), collapsed and fetched only on first open; `startedRef` blocks a second walk while one is in flight, keyed per mounted run.
import { useEffect, useMemo, useRef, useState } from "react";
import { parseAgentRunTurn, type AgentRunTurn } from "@/lib/run-turn-types";
import {
  MAX_TURNS_LOADED,
  MAX_WALK_PAGES,
  conversationEntries,
  nextTurnsCursor,
  parseHasMore,
  serverReportsMore,
  turnsForNode,
  turnsUrl,
} from "./turn-transcript-presenter";
import {
  segmentLabel,
  segmentTurns,
  type TurnSegment,
} from "@/lib/turn-segments";
import CollapsibleCard from "@/components/CollapsibleCard";
import styles from "./FullTranscriptPanel.module.css";
import {
  TranscriptCapped,
  TranscriptEmpty,
  TranscriptError,
  TranscriptLoading,
  TranscriptToggleRow,
  TranscriptTurnsList,
  type NodeSegmentView,
} from "./TranscriptSections";

export interface FullTranscriptPanelProps {
  runId: string;
  nodeId: string;
}

function exceededWalkBudget(turnsLoaded: number, pages: number): boolean {
  return turnsLoaded >= MAX_TURNS_LOADED || pages >= MAX_WALK_PAGES;
}

function walkErrorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

interface TranscriptDisplayInput {
  error: string | null;
  open: boolean;
  turns: AgentRunTurn[] | null;
  capped: boolean;
  nodeTurnsCount: number;
}

/** Whether the loading / capped / empty notices apply — pulled out so the JSX below is a flat, branch-free layout. */
function transcriptMessageFlags({
  error,
  open,
  turns,
  capped,
  nodeTurnsCount,
}: TranscriptDisplayInput): {
  showLoading: boolean;
  showCapped: boolean;
  showEmpty: boolean;
} {
  const noError = !error;

  return {
    showLoading: noError && open && turns === null,
    showCapped: noError && capped,
    showEmpty: noError && turns !== null && nodeTurnsCount === 0,
  };
}

/** Whether the format toggle + turns list apply — no error, and at least one turn for this node. */
function transcriptListVisible({
  error,
  nodeTurnsCount,
}: Pick<TranscriptDisplayInput, "error" | "nodeTurnsCount">): boolean {
  return !error && nodeTurnsCount > 0;
}

async function fetchTurnsPage(runId: string, cursor: string) {
  const res = await fetch(turnsUrl(runId, cursor), {
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  const body = (await res.json()) as { turns?: unknown[]; hasMore?: unknown };
  const rows = Array.isArray(body.turns) ? body.turns : [];

  return { rows, hasMoreFlag: parseHasMore(body) };
}

/** One full walk of the turns endpoint, honoring the page/turn caps; throws on transport failure. */
async function walkAllTurns(
  runId: string,
  isDisposed: () => boolean,
): Promise<{ turns: AgentRunTurn[]; hitCap: boolean }> {
  const collected: AgentRunTurn[] = [];
  let cursor = "0";
  let pages = 0;

  for (;;) {
    const { rows, hasMoreFlag } = await fetchTurnsPage(runId, cursor);

    if (isDisposed()) {
      return { turns: collected, hitCap: false };
    }
    pages += 1;
    rows.forEach((row) => {
      const parsed = parseAgentRunTurn(row);

      if (parsed !== null) {
        collected.push(parsed);
      }
    });

    const next = nextTurnsCursor(rows, hasMoreFlag);

    if (next === null) {
      return { turns: collected, hitCap: serverReportsMore(rows, hasMoreFlag) };
    }

    if (exceededWalkBudget(collected.length, pages)) {
      return { turns: collected, hitCap: true };
    }
    cursor = next;
  }
}

/** Walks the transcript once. A failure RE-ARMS the started gate, so closing and reopening retries instead of pinning the error until a page reload; the stale error is cleared up front so a retry reads as Loading rather than as the previous failure. */
async function loadTranscript(
  runId: string,
  refs: { disposedRef: { current: boolean }; startedRef: { current: boolean } },
  set: {
    setTurns: (turns: AgentRunTurn[]) => void;
    setCapped: (capped: boolean) => void;
    setError: (error: string | null) => void;
  },
): Promise<void> {
  try {
    set.setError(null);
    const result = await walkAllTurns(runId, () => refs.disposedRef.current);

    if (refs.disposedRef.current) {
      return;
    }
    set.setTurns(result.turns);
    set.setCapped(result.hitCap);
    set.setError(null);
  } catch (e) {
    if (!refs.disposedRef.current) {
      set.setError(walkErrorMessage(e));
      refs.startedRef.current = false;
    }
  }
}

/** Walks the transcript ONCE per open. A failure re-arms the gate, so closing and reopening retries instead of pinning the error until a page reload; unmount is the only cancellation, because a re-closed panel still wants the data it asked for. */
function useTranscriptWalk(runId: string) {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<AgentRunTurn[] | null>(null);
  const [capped, setCapped] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const startedRef = useRef(false);
  // Unmount is the only cancellation — a re-closed panel still wants its data, but a dead component must not receive it.
  const disposedRef = useRef(false);

  useEffect(
    () => () => {
      disposedRef.current = true;
    },
    [],
  );

  useEffect(() => {
    if (!open || startedRef.current) {
      return;
    }
    startedRef.current = true;

    void loadTranscript(
      runId,
      { disposedRef, startedRef },
      { setTurns, setCapped, setError },
    );
  }, [open, runId]);

  return { open, setOpen, turns, capped, error, showRaw, setShowRaw };
}

/** This node's turns, grouped into the conversation segments the list renders. */
function useNodeSegments(turns: AgentRunTurn[] | null, nodeId: string) {
  const nodeTurns = useMemo(
    () => (turns === null ? [] : turnsForNode(turns, nodeId)),
    [turns, nodeId],
  );
  const nodeSegments: NodeSegmentView[] = useMemo(
    () =>
      segmentTurns(nodeTurns).map((segment: TurnSegment) => ({
        label: segmentLabel(segment),
        entries: conversationEntries(segment.turns),
      })),
    [nodeTurns],
  );

  return { nodeTurns, nodeSegments };
}

/** Which of the panel's mutually exclusive states is on screen. One decision, so the four flags are resolved together rather than each child asking separately. */
function bodyFlags(
  walk: ReturnType<typeof useTranscriptWalk>,
  segments: ReturnType<typeof useNodeSegments>,
) {
  const displayInput: TranscriptDisplayInput = {
    error: walk.error,
    open: walk.open,
    turns: walk.turns,
    capped: walk.capped,
    nodeTurnsCount: segments.nodeTurns.length,
  };

  return {
    ...transcriptMessageFlags(displayInput),
    showList: transcriptListVisible(displayInput),
  };
}

/** The states shown INSTEAD of turns. Each child renders only when its own flag is set, and at most one flag is ever true. */
function TranscriptNotices({
  error,
  flags,
  turnsLoaded,
  nodeId,
}: {
  error: string | null;
  flags: { showLoading: boolean; showCapped: boolean; showEmpty: boolean };
  turnsLoaded: number;
  nodeId: string;
}) {
  return (
    <>
      <TranscriptError error={error} />
      <TranscriptLoading show={flags.showLoading} />
      <TranscriptCapped show={flags.showCapped} turnsLoaded={turnsLoaded} />
      <TranscriptEmpty show={flags.showEmpty} nodeId={nodeId} />
    </>
  );
}

/** Everything inside the card. Exactly one of the messages or the list is on screen at a time, so the flags are resolved here rather than by each child deciding for itself. */
interface TranscriptBodyProps {
  walk: ReturnType<typeof useTranscriptWalk>;
  segments: ReturnType<typeof useNodeSegments>;
  nodeId: string;
}

function TranscriptBody({ walk, segments, nodeId }: TranscriptBodyProps) {
  const { turns, error, showRaw } = walk;
  const { showList, ...flags } = bodyFlags(walk, segments);

  return (
    <>
      <TranscriptToggleRow
        show={showList}
        showRaw={showRaw}
        onChange={walk.setShowRaw}
      />
      <TranscriptNotices
        error={error}
        flags={flags}
        turnsLoaded={(turns ?? []).length}
        nodeId={nodeId}
      />
      <TranscriptTurnsList
        show={showList}
        showRaw={showRaw}
        turns={segments.nodeTurns}
        segments={segments.nodeSegments}
      />
    </>
  );
}

export default function FullTranscriptPanel({
  runId,
  nodeId,
}: FullTranscriptPanelProps) {
  const walk = useTranscriptWalk(runId);
  const segments = useNodeSegments(walk.turns, nodeId);

  return (
    <CollapsibleCard title="Full transcript" onToggle={walk.setOpen}>
      <p className={`meta ${styles.hint}`}>
        Untruncated turns from the transcript store (30-day retention). The live
        view above stays truncated by design.
      </p>
      <TranscriptBody walk={walk} segments={segments} nodeId={nodeId} />
    </CollapsibleCard>
  );
}
