// Pure per-node transcript: rows in, DOM out. No fetch, no EventSource, no
// timers — the Panel above owns every one of those (lore/no-io-in-view).

import { memo } from "react";
import type { TranscriptRow } from "@/lib/transcript-rows";
import CollapsibleCard from "@/components/CollapsibleCard";
import styles from "./NodeTranscriptView.module.css";

export interface NodeTranscriptViewProps {
  nodeId: string;
  rows: readonly TranscriptRow[];
  droppedCount: number;
}

/** The input card's body as one text flow — the same structure as every other
 *  card's body, never a bespoke tree of paragraphs and definition lists. */
export function inputCardText(
  row: Extract<TranscriptRow, { kind: "input" }>,
): string {
  return [
    `${row.repo} @ ${row.ref}`,
    row.description,
    row.prompt,
    ...row.params.map(([key, value]) => `${key}: ${value}`),
  ]
    .filter((part): part is string => Boolean(part))
    .join("\n\n");
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
      <CollapsibleCard
        title="Input"
        labels={[row.summary, row.truncated ? "truncated" : null]}
      >
        {inputCardText(row)}
      </CollapsibleCard>
    );
  }

  if (row.kind === "iteration") {
    return (
      <div className={styles.divider}>
        <span>Iteration {row.iteration}</span>
      </div>
    );
  }

  if (row.kind === "init") {
    return (
      <div className={styles.lifecycle}>
        <span className={styles.label}>Started iteration {row.iteration}</span>
      </div>
    );
  }

  if (row.kind === "message") {
    return (
      <div className={styles.message}>
        <p className={styles.text}>{row.text}</p>
      </div>
    );
  }

  if (row.kind === "tool_call") {
    return (
      <div className={styles.toolCall}>
        <span className={styles.tool}>{row.tool}</span>
        <span className={styles.text}>{row.summary}</span>
      </div>
    );
  }

  if (row.kind === "hook") {
    return (
      <div className={row.isError ? styles.errorRow : styles.lifecycle}>
        <span className={styles.label}>{row.name}</span>
        <span className={styles.text}>{row.summary}</span>
      </div>
    );
  }

  if (row.kind === "result") {
    return (
      <div className={row.isError ? styles.errorRow : styles.lifecycle}>
        <span className={styles.label}>
          {row.isError ? "Failed" : "Finished"}
        </span>
        <span className={styles.text}>{row.text}</span>
      </div>
    );
  }

  return (
    <CollapsibleCard
      title={row.isError ? "Error" : (row.tool ?? "Result")}
      className={row.isError ? styles.errorRow : undefined}
      labels={[
        row.isError ? row.tool : null,
        row.summary,
        row.truncated ? "truncated" : null,
      ]}
    >
      {row.detail}
    </CollapsibleCard>
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
        <div className={styles.rows}>
          {rows.map((row) => (
            <Row key={rowKey(row)} row={row} />
          ))}
        </div>
      )}
    </div>
  );
}
