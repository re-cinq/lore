"use client";

// The on-demand full-fidelity transcript for the selected node, read from the
// turn-level transcript store (specs/turn-level-transcript-store, #1148)
// through the session-authed /turns proxy. Collapsed by default and fetched
// only on first open, so the truncated live view — which stays the page's
// default — pays nothing for this panel's existence.
//
// One walk per mounted run: the parent keys this mount on the run id, so a
// run change remounts with fresh state (the parent's own historyLoadedFor
// lesson), and `startedRef` keeps toggling the panel from starting a second
// walk while the first is in flight. Switching the selected node refilters
// the already-loaded line-scoped turns instead of refetching.

import { useEffect, useMemo, useRef, useState } from "react";
import { parseAgentRunTurn, type AgentRunTurn } from "@/lib/run-turn-types";
import {
  MAX_TURNS_LOADED,
  MAX_WALK_PAGES,
  envelopePretty,
  nextTurnsCursor,
  parseHasMore,
  serverReportsMore,
  turnHeading,
  turnsForNode,
  turnsUrl,
} from "./turn-transcript-presenter";
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
  const startedRef = useRef(false);
  // Unmount is the only cancellation: a re-closed panel still wants the data
  // it asked for, but a dead component must not receive it.
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
        // A reopen retries a failed walk — drop the stale error so the retry
        // shows Loading… rather than the previous failure.
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

          for (const row of rows) {
            const parsed = parseAgentRunTurn(row);

            if (parsed !== null) {
              collected.push(parsed);
            }
          }

          const hasMoreFlag = parseHasMore(body);
          const next = nextTurnsCursor(rows, hasMoreFlag);

          if (next === null) {
            // A drained transcript ends silently; a stalled one — the server
            // reports more but the page carries no usable cursor — must not,
            // because this one-shot walk never retries.
            hitCap = serverReportsMore(rows, hasMoreFlag);
            break;
          }

          // The page bound backstops a Floor clamp far below the requested
          // page size — bounded requests, and a visible notice instead of a
          // silently partial transcript.
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
          // A failed walk re-arms the gate, so closing and reopening the
          // panel retries instead of pinning the error until a page reload.
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

  return (
    <details
      className={styles.panel}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className={styles.summary}>Full transcript</summary>
      <p className={`meta ${styles.hint}`}>
        Untruncated turns from the transcript store (30-day retention). The live
        view above stays truncated by design.
      </p>

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

      {!error && nodeTurns.length > 0 && (
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
    </details>
  );
}
