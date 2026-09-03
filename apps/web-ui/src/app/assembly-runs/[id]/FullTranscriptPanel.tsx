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
} from "./turn-transcript-presenter";
import { segmentLabel, segmentTurns } from "@/lib/turn-segments";
import CollapsibleCard from "@/components/CollapsibleCard";
import { EntryLine } from "@/components/LogEntriesView";
import LogFormatToggle from "@/components/LogFormatToggle";
import styles from "./FullTranscriptPanel.module.css";

export interface FullTranscriptPanelProps {
  runId: string;
  nodeId: string;
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

    async function walk() {
      try {
        // A reopen retries a failed walk — drop the stale error so the retry shows Loading… rather than the previous failure.
        setError(null);
        const collected: AgentRunTurn[] = [];
        let cursor = "0";
        let pages = 0;
        let hitCap = false;

        for (;;) {
          const res = await fetch(turnsUrl(runId, cursor), {
            signal: AbortSignal.timeout(15_000),
          });

          if (disposedRef.current) {
            return;
          }

          if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
          }

          const body = (await res.json()) as {
            turns?: unknown[];
            hasMore?: unknown;
          };

          if (disposedRef.current) {
            return;
          }

          const rows = Array.isArray(body.turns) ? body.turns : [];

          pages += 1;

          rows.forEach((row) => {
            const parsed = parseAgentRunTurn(row);

            if (parsed !== null) {
              collected.push(parsed);
            }
          });

          const hasMoreFlag = parseHasMore(body);
          const next = nextTurnsCursor(rows, hasMoreFlag);

          if (next === null) {
            // A drained transcript ends silently; a stalled one (server reports more, no usable cursor) must not, since this one-shot walk never retries.
            hitCap = serverReportsMore(rows, hasMoreFlag);
            break;
          }

          // Backstops a Floor clamp far below the requested page size — bounded requests plus a visible notice instead of a silent partial transcript.
          if (collected.length >= MAX_TURNS_LOADED || pages >= MAX_WALK_PAGES) {
            hitCap = true;
            break;
          }
          cursor = next;
        }

        setTurns(collected);
        setCapped(hitCap);
        setError(null);
      } catch (e) {
        if (!disposedRef.current) {
          setError(e instanceof Error ? e.message : String(e));
          // Re-arms the gate so closing/reopening retries instead of pinning the error until a page reload.
          startedRef.current = false;
        }
      }
    }

    void walk();
  }, [open, runId]);

  const nodeTurns = useMemo(
    () => (turns === null ? [] : turnsForNode(turns, nodeId)),
    [turns, nodeId],
  );
  const nodeSegments = useMemo(
    () =>
      segmentTurns(nodeTurns).map((segment) => ({
        label: segmentLabel(segment),
        entries: conversationEntries(segment.turns),
      })),
    [nodeTurns],
  );

  return (
    <CollapsibleCard title="Full transcript" onToggle={setOpen}>
      <p className={`meta ${styles.hint}`}>
        Untruncated turns from the transcript store (30-day retention). The live
        view above stays truncated by design.
      </p>

      {!error && nodeTurns.length > 0 && (
        <div className={styles.toggleRow}>
          <LogFormatToggle raw={showRaw} onChange={setShowRaw} />
        </div>
      )}

      {error && <p className={styles.error}>Failed to load turns: {error}</p>}

      {!error && open && turns === null && (
        <p className={`meta ${styles.placeholder}`}>Loading…</p>
      )}

      {!error && capped && (
        <p className={`meta ${styles.notice}`}>
          Loaded only the first {(turns ?? []).length} turns of this run.
        </p>
      )}

      {!error && turns !== null && nodeTurns.length === 0 && (
        <p className={`meta ${styles.placeholder}`}>
          No stored turns for {nodeId}. Turns older than the retention horizon
          are pruned.
        </p>
      )}

      {!error && nodeTurns.length > 0 && showRaw && (
        <ol className={styles.turns}>
          {nodeTurns.map((turn) => (
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
      )}

      {!error && nodeTurns.length > 0 && !showRaw && (
        <ol className={styles.segments}>
          {nodeSegments.map((segment, index) => (
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
      )}
    </CollapsibleCard>
  );
}
