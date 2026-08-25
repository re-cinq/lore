// Pure per-node transcript: rows in, DOM out. No fetch, no EventSource, no
// timers — the Panel above owns every one of those (lore/no-io-in-view).
//
// The scroll decisions live here as pure functions rather than as effects,
// because jsdom reports every geometry property as 0: a follow-the-tail rule
// expressed as an effect would be untestable, and the same rule expressed as
// arithmetic is not.

import { memo } from "react";
import type { TranscriptRow } from "@/lib/transcript-rows";
import styles from "./NodeTranscriptView.module.css";

/** Within this many pixels of the bottom still counts as "at the bottom". */
const TAIL_SLACK = 48;

/**
 * Should new rows scroll into view? Only when the reader is already at the
 * bottom — yanking the viewport out from under someone reading back is worse
 * than making them scroll down themselves.
 */
export function shouldFollowTail(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
): boolean {
  return scrollHeight - scrollTop - clientHeight <= TAIL_SLACK;
}

/** Record one node's scroll offset without mutating the offsets passed in. */
export function rememberScroll(
  offsets: Readonly<Record<string, number>>,
  nodeId: string,
  offset: number,
): Record<string, number> {
  return { ...offsets, [nodeId]: offset };
}

/** A node's remembered offset; the top for one never scrolled. */
export function recallScroll(
  offsets: Readonly<Record<string, number>>,
  nodeId: string,
): number {
  return offsets[nodeId] ?? 0;
}

export interface NodeTranscriptViewProps {
  nodeId: string;
  rows: readonly TranscriptRow[];
  droppedCount: number;
}

function rowKey(row: TranscriptRow): string {
  if (row.kind === "iteration") {
    return `iteration-${row.iteration}`;
  }

  return row.kind === "input" ? `input-${row.iteration}` : row.seq;
}

const Row = memo(function Row({ row }: { row: TranscriptRow }) {
  if (row.kind === "input") {
    // Collapsed like a tool result, and for the same reason: a 16 KB prompt would
    // otherwise bury the transcript it is supposed to introduce.
    return (
      <li className={styles.input}>
        <details>
          <summary>
            <span className={styles.label}>Input</span>
            <span className={styles.text}>{row.summary}</span>
            {row.truncated ? (
              <span className={styles.badge}>truncated</span>
            ) : null}
          </summary>
          <p className={styles.meta}>
            {row.repo} @ {row.ref}
          </p>
          <pre className={styles.detail}>{row.description}</pre>
          {row.prompt ? (
            <pre className={styles.detail}>{row.prompt}</pre>
          ) : null}
          {row.params.length > 0 ? (
            <dl className={styles.params}>
              {row.params.map(([key, value]) => (
                <div key={key}>
                  <dt>{key}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </details>
      </li>
    );
  }

  if (row.kind === "iteration") {
    return (
      <li className={styles.divider}>
        <span>Iteration {row.iteration}</span>
      </li>
    );
  }

  if (row.kind === "init") {
    return (
      <li className={styles.lifecycle}>
        <span className={styles.label}>Started iteration {row.iteration}</span>
      </li>
    );
  }

  if (row.kind === "message") {
    return (
      <li className={styles.message}>
        <p className={styles.text}>{row.text}</p>
      </li>
    );
  }

  if (row.kind === "tool_call") {
    return (
      <li className={styles.toolCall}>
        <span className={styles.tool}>{row.tool}</span>
        <span className={styles.text}>{row.summary}</span>
      </li>
    );
  }

  if (row.kind === "result") {
    return (
      <li className={row.isError ? styles.errorRow : styles.lifecycle}>
        <span className={styles.label}>
          {row.isError ? "Failed" : "Finished"}
        </span>
        <span className={styles.text}>{row.text}</span>
      </li>
    );
  }

  return (
    <li className={row.isError ? styles.errorRow : styles.toolResult}>
      <details>
        <summary>
          {row.isError ? <span className={styles.label}>Error</span> : null}
          {row.tool ? <span className={styles.tool}>{row.tool}</span> : null}
          <span className={styles.text}>{row.summary}</span>
          {row.truncated ? (
            <span className={styles.badge}>truncated</span>
          ) : null}
        </summary>
        <pre className={styles.detail}>{row.detail}</pre>
      </details>
    </li>
  );
});

export default function NodeTranscriptView({
  nodeId,
  rows,
  droppedCount,
}: NodeTranscriptViewProps) {
  return (
    <div className={styles.transcript}>
      {droppedCount > 0 ? (
        <p className={styles.notice} role="status">
          {droppedCount} older events were dropped.
        </p>
      ) : null}
      {rows.length === 0 ? (
        <p className={styles.empty}>No agent events for {nodeId} yet.</p>
      ) : (
        <ol className={styles.rows}>
          {rows.map((row) => (
            <Row key={rowKey(row)} row={row} />
          ))}
        </ol>
      )}
    </div>
  );
}
