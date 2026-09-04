"use client";

// On-demand full-fidelity transcript (specs/turn-level-transcript-store #1148), collapsed and fetched only on first open; `startedRef` blocks a second walk while one is in flight, keyed per mounted run.
import { useEffect, useMemo, useRef, useState } from "react";
import { parseAgentRunTurn, type AgentRunTurn } from "@/lib/run-turn-types";
import {
  MAX_TURNS_LOADED,
  MAX_WALK_PAGES,
  clockTime,
  conversationEntries,
  envelopePretty,
  nextTurnsCursor,
  parseHasMore,
  serverReportsMore,
  turnHeading,
  turnsForNode,
  turnsUrl,
  type TimedLogEntry,
} from "./turn-transcript-presenter";
import {
  segmentLabel,
  segmentTurns,
  type TurnSegment,
} from "@/lib/turn-segments";
import CollapsibleCard from "@/components/CollapsibleCard";
import { EntryLine } from "@/components/LogEntriesView";
import LogFormatToggle from "@/components/LogFormatToggle";
import styles from "./FullTranscriptPanel.module.css";

export interface FullTranscriptPanelProps {
  runId: string;
  nodeId: string;
}

interface NodeSegmentView {
  label: string | null;
  entries: TimedLogEntry[];
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

// Loading… only once the card has actually been opened; a closed card shows nothing while resp is still null.
function TranscriptLoading({ show }: { show: boolean }) {
  if (!show) {
    return null;
  }

  return <p className={`meta ${styles.placeholder}`}>Loading…</p>;
}

function TranscriptError({ error }: { error: string | null }) {
  if (!error) {
    return null;
  }

  return <p className={styles.error}>Failed to load turns: {error}</p>;
}

function TranscriptCapped({
  show,
  turnsLoaded,
}: {
  show: boolean;
  turnsLoaded: number;
}) {
  if (!show) {
    return null;
  }

  return (
    <p className={`meta ${styles.notice}`}>
      Loaded only the first {turnsLoaded} turns of this run.
    </p>
  );
}

function TranscriptEmpty({ show, nodeId }: { show: boolean; nodeId: string }) {
  if (!show) {
    return null;
  }

  return (
    <p className={`meta ${styles.placeholder}`}>
      No stored turns for {nodeId}. Turns older than the retention horizon are
      pruned.
    </p>
  );
}

function TranscriptToggleRow({
  show,
  showRaw,
  onChange,
}: {
  show: boolean;
  showRaw: boolean;
  onChange: (raw: boolean) => void;
}) {
  if (!show) {
    return null;
  }

  return (
    <div className={styles.toggleRow}>
      <LogFormatToggle raw={showRaw} onChange={onChange} />
    </div>
  );
}

function RawTurnsList({ turns }: { turns: AgentRunTurn[] }) {
  return (
    <ol className={styles.turns}>
      {turns.map((turn) => (
        <li key={turn.id} className={styles.turn}>
          <details>
            <summary className={styles.turnSummary}>
              <span className={styles.kind}>{turnHeading(turn)}</span>
              {turn.iteration !== null && (
                <span className={styles.iteration}>
                  iteration {turn.iteration}
                </span>
              )}
              <time dateTime={turn.createdAt}>
                {new Date(turn.createdAt).toLocaleString()}
              </time>
            </summary>
            <pre className={styles.envelope}>{envelopePretty(turn)}</pre>
          </details>
        </li>
      ))}
    </ol>
  );
}

function SegmentedTurnsList({ segments }: { segments: NodeSegmentView[] }) {
  return (
    <ol className={styles.segments}>
      {segments.map((segment, index) => (
        <li key={index} className={styles.segment}>
          {segment.label !== null && (
            <div className={styles.segmentHeader}>{segment.label}</div>
          )}
          <ol className={styles.entries}>
            {segment.entries.map((timed, i) => (
              <li key={i} className={styles.entryRow}>
                <time className={styles.entryTime} dateTime={timed.at}>
                  {clockTime(timed.at)}
                </time>
                <div className={styles.entryBody}>
                  <EntryLine entry={timed.entry} />
                </div>
              </li>
            ))}
          </ol>
        </li>
      ))}
    </ol>
  );
}

function TranscriptTurnsList({
  show,
  showRaw,
  turns,
  segments,
}: {
  show: boolean;
  showRaw: boolean;
  turns: AgentRunTurn[];
  segments: NodeSegmentView[];
}) {
  if (!show) {
    return null;
  }

  return showRaw ? (
    <RawTurnsList turns={turns} />
  ) : (
    <SegmentedTurnsList segments={segments} />
  );
}

export default function FullTranscriptPanel({
  runId,
  nodeId,
}: FullTranscriptPanelProps) {
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

    async function load() {
      try {
        // A reopen retries a failed walk — drop the stale error so the retry shows Loading… rather than the previous failure.
        setError(null);
        const result = await walkAllTurns(runId, () => disposedRef.current);

        if (disposedRef.current) {
          return;
        }
        setTurns(result.turns);
        setCapped(result.hitCap);
        setError(null);
      } catch (e) {
        if (!disposedRef.current) {
          setError(walkErrorMessage(e));
          // Re-arms the gate so closing/reopening retries instead of pinning the error until a page reload.
          startedRef.current = false;
        }
      }
    }

    void load();
  }, [open, runId]);

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

  const displayInput: TranscriptDisplayInput = {
    error,
    open,
    turns,
    capped,
    nodeTurnsCount: nodeTurns.length,
  };
  const { showLoading, showCapped, showEmpty } =
    transcriptMessageFlags(displayInput);
  const showList = transcriptListVisible(displayInput);

  return (
    <CollapsibleCard title="Full transcript" onToggle={setOpen}>
      <p className={`meta ${styles.hint}`}>
        Untruncated turns from the transcript store (30-day retention). The live
        view above stays truncated by design.
      </p>
      <TranscriptToggleRow
        show={showList}
        showRaw={showRaw}
        onChange={setShowRaw}
      />
      <TranscriptError error={error} />
      <TranscriptLoading show={showLoading} />
      <TranscriptCapped show={showCapped} turnsLoaded={(turns ?? []).length} />
      <TranscriptEmpty show={showEmpty} nodeId={nodeId} />
      <TranscriptTurnsList
        show={showList}
        showRaw={showRaw}
        turns={nodeTurns}
        segments={nodeSegments}
      />
    </CollapsibleCard>
  );
}
