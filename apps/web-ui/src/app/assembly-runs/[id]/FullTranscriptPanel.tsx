"use client";

// The full-fidelity transcript (specs/turn-level-transcript-store #1148), open by default and walked on mount; `startedRef` blocks a second walk while one is in flight, keyed per mounted run. Since 2026-09-09 it is the ONE transcript surface, drawn as a terminal session with the task's transitions folded in (run-viz FR4.17–FR4.18).
import { useEffect, useMemo, useRef, useState } from "react";
import type { AssemblyRunNode } from "@/lib/assembly-runs";
import type { TaskRuntimeEvent } from "@/lib/task-runtime";
import {
  mergeTranscript,
  nodeWindow,
  segmentEntries,
  taskEventEntries,
} from "@/lib/transcript-entries";
import type { AgentRunTurn } from "@/lib/run-turn-types";
import { conversationEntries, turnsForNode } from "./turn-transcript-presenter";
import { walkAllTurns, walkErrorMessage } from "./transcript-walk";
import {
  segmentLabel,
  segmentTurns,
  type TurnSegment,
} from "@/lib/turn-segments";
import CollapsibleCard from "@/components/CollapsibleCard";
import styles from "./TranscriptView.module.css";
import {
  TranscriptCapped,
  TranscriptEmpty,
  TranscriptError,
  TranscriptLoading,
  TranscriptTurnsList,
} from "./TranscriptView";

export interface FullTranscriptPanelProps {
  runId: string;
  nodeId: string;
  /** The task's status transitions; the ones inside this node's visits render as system lines. */
  taskEvents?: readonly TaskRuntimeEvent[];
  /** This node's visit rows, whose span decides which task events belong to it. */
  rows?: readonly AssemblyRunNode[];
}

const NO_EVENTS: readonly TaskRuntimeEvent[] = [];
const NO_ROWS: readonly AssemblyRunNode[] = [];

export default function FullTranscriptPanel(props: FullTranscriptPanelProps) {
  const { runId, nodeId, taskEvents = NO_EVENTS, rows = NO_ROWS } = props;
  const walk = useTranscriptWalk(runId);
  const segments = useNodeSegments({
    turns: walk.turns,
    nodeId,
    taskEvents,
    rows,
  });

  return (
    <CollapsibleCard title="Transcript" defaultOpen onToggle={walk.setOpen}>
      <p className={`meta ${styles.hint}`}>
        Untruncated turns from the transcript store (30-day retention), with the
        task&apos;s status changes in this step folded in.
      </p>
      <TranscriptBody walk={walk} segments={segments} nodeId={nodeId} />
    </CollapsibleCard>
  );
}

function useTranscriptWalk(runId: string) {
  const [open, setOpen] = useState(true);
  const { turns, capped, error } = useTranscriptData(runId, { open });

  return { open, setOpen, turns, capped, error };
}

/** What the conversation is folded from: the node's turns, and the task events inside its window. */
interface ConversationSources {
  turns: AgentRunTurn[] | null;
  nodeId: string;
  taskEvents: readonly TaskRuntimeEvent[];
  rows: readonly AssemblyRunNode[];
}

/** This node's turns as one terminal conversation: segmented per visit, tool calls paired with their results, the task's transitions in that window merged in by clock. */
function useNodeSegments(sources: ConversationSources) {
  const { turns, nodeId, taskEvents, rows } = sources;
  const nodeTurns = useMemo(
    () => (turns === null ? [] : turnsForNode(turns, nodeId)),
    [turns, nodeId],
  );
  const entries = useMemo(() => {
    const agent = segmentEntries(
      segmentTurns(nodeTurns).map((segment: TurnSegment) => ({
        label: segmentLabel(segment),
        entries: conversationEntries(segment.turns),
      })),
    );

    return mergeTranscript(
      agent,
      taskEventEntries(taskEvents, nodeWindow(rows)),
    );
  }, [nodeTurns, taskEvents, rows]);

  return { nodeTurns, entries };
}

/** Everything inside the card. Exactly one of the messages or the list is on screen at a time, so the flags are resolved here rather than by each child deciding for itself. */
interface TranscriptBodyProps {
  walk: ReturnType<typeof useTranscriptWalk>;
  segments: ReturnType<typeof useNodeSegments>;
  nodeId: string;
}

interface TranscriptListProps {
  show: boolean;
  segments: ReturnType<typeof useNodeSegments>;
}

function TranscriptBody({ walk, segments, nodeId }: TranscriptBodyProps) {
  const { turns, error } = walk;
  const { showList, ...flags } = bodyFlags(walk, segments);

  return (
    <>
      <TranscriptNotices
        error={error}
        flags={flags}
        turnsLoaded={(turns ?? []).length}
        nodeId={nodeId}
      />
      <TranscriptList show={showList} segments={segments} />
    </>
  );
}

interface TranscriptDisplayInput {
  error: string | null;
  open: boolean;
  turns: AgentRunTurn[] | null;
  capped: boolean;
  /** Everything the conversation would draw: the node's turns plus the task events inside its window. */
  entryCount: number;
}

/** Walks the transcript ONCE per open. A failure re-arms the gate, so closing and reopening retries instead of pinning the error until a page reload. */
function useTranscriptData(runId: string, { open }: { open: boolean }) {
  const [turns, setTurns] = useState<AgentRunTurn[] | null>(null);
  const [capped, setCapped] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);
  const disposedRef = useDisposedRef();

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
  }, [open, runId, disposedRef]);

  return { turns, capped, error };
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
    entryCount: segments.entries.length,
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

function TranscriptList({ show, segments }: TranscriptListProps) {
  return <TranscriptTurnsList show={show} entries={segments.entries} />;
}

interface WalkRefs {
  disposedRef: { current: boolean };
  startedRef: { current: boolean };
}

interface TranscriptSetters {
  setTurns: (turns: AgentRunTurn[]) => void;
  setCapped: (capped: boolean) => void;
  setError: (error: string | null) => void;
}

// Unmount is the only cancellation — a re-closed panel still wants its data, but a dead component must not receive it.
function useDisposedRef() {
  const disposedRef = useRef(false);

  useEffect(
    () => () => {
      disposedRef.current = true;
    },
    [],
  );

  return disposedRef;
}

/** Walks the transcript once. The stale error is cleared up front so a retry reads as Loading rather than as the previous failure. */
async function loadTranscript(
  runId: string,
  refs: WalkRefs,
  set: TranscriptSetters,
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
    failTranscript(e, refs, set);
  }
}

/** Whether the loading / capped / empty notices apply — pulled out so the JSX below is a flat, branch-free layout. */
function transcriptMessageFlags({
  error,
  open,
  turns,
  capped,
  entryCount,
}: TranscriptDisplayInput): {
  showLoading: boolean;
  showCapped: boolean;
  showEmpty: boolean;
} {
  const noError = !error;

  return {
    showLoading: noError && open && turns === null,
    showCapped: noError && capped,
    showEmpty: noError && turns !== null && entryCount === 0,
  };
}

/** Whether the conversation applies — no error, and something to draw for this node. */
function transcriptListVisible({
  error,
  entryCount,
}: Pick<TranscriptDisplayInput, "error" | "entryCount">): boolean {
  return !error && entryCount > 0;
}

/** A failed walk RE-ARMS the started gate, so closing and reopening retries instead of pinning the error until a page reload. A disposed panel is told nothing. */
function failTranscript(e: unknown, refs: WalkRefs, set: TranscriptSetters) {
  if (refs.disposedRef.current) {
    return;
  }
  set.setError(walkErrorMessage(e));
  refs.startedRef.current = false;
}
