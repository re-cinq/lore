// The transcript as a terminal session (run-viz FR4.17): one monospace block, each entry headed by its clock, assistant prose in the open, tool calls folded to one line with their result behind it, thinking folded, task transitions as system lines, and a dim rule per visit. Pure render; the panel above owns the walk.
import type { ReactNode } from "react";
import { clip } from "@/lib/agent-log-entries";
import { clockShown, type TranscriptEntry } from "@/lib/transcript-entries";
import { clockTime } from "./turn-transcript-presenter";
import { EntryLine } from "@/components/LogEntriesView";
import styles from "./TranscriptView.module.css";

const SUMMARY_MAX = 120;

// Loading… only once the walk has started; a panel that never opened shows nothing while turns are still null.
export function TranscriptLoading({ show }: { show: boolean }) {
  if (!show) {
    return null;
  }

  return <p className={`meta ${styles.placeholder}`}>Loading…</p>;
}

export function TranscriptError({ error }: { error: string | null }) {
  if (!error) {
    return null;
  }

  return <p className={styles.error}>Failed to load turns: {error}</p>;
}

export function TranscriptCapped({
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

export function TranscriptEmpty({
  show,
  nodeId,
}: {
  show: boolean;
  nodeId: string;
}) {
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

type Of<K extends TranscriptEntry["kind"]> = Extract<
  TranscriptEntry,
  { kind: K }
>;

/** The first line of a result, shown after the call so a reader need not open it to know how it went. */
function ResultPeek({ text }: { text: string }) {
  return (
    <span className={styles.resultPeek}> ← {clip(text, SUMMARY_MAX)}</span>
  );
}

/** A call with its result: the one-line summary, the result peeking after it, the whole result a click away; tinted when it errored. */
function ToolCallDetails({
  summary,
  result,
}: {
  summary: string;
  result: NonNullable<Of<"tool-call">["result"]>;
}) {
  return (
    <details
      className={result.isError ? styles.toolError : styles.tool}
      data-tool-call
    >
      <summary className={styles.summary}>
        ▸ {summary}
        <ResultPeek text={result.text} />
      </summary>
      <pre className={styles.resultBody}>{result.text}</pre>
    </details>
  );
}

/** `▸ Read src/a.ts` with the result a click away; an open call (no result yet) says so. */
function ToolCallRow({ entry }: { entry: Of<"tool-call"> }) {
  const { result, summary } = entry;

  if (result === null) {
    return (
      <div className={styles.tool} data-tool-call="open">
        ▸ {summary} <span className={styles.dim}>…</span>
      </div>
    );
  }

  return <ToolCallDetails summary={summary} result={result} />;
}

function ThinkingRow({ entry }: { entry: Of<"thinking"> }) {
  return (
    <details className={styles.thinking} data-thinking>
      <summary className={styles.summary}>thinking…</summary>
      <pre className={styles.resultBody}>{entry.text}</pre>
    </details>
  );
}

function TaskEventRow({ entry }: { entry: Of<"task-event"> }) {
  if (entry.metadata === null) {
    return (
      <div className={styles.system} data-task-event>
        · {entry.label}
      </div>
    );
  }

  return (
    <details className={styles.system} data-task-event>
      <summary className={styles.summary}>· {entry.label}</summary>
      <pre className={styles.resultBody}>
        {JSON.stringify(entry.metadata, null, 2)}
      </pre>
    </details>
  );
}

const ROW: { [K in TranscriptEntry["kind"]]: (entry: Of<K>) => ReactNode } = {
  turn: (entry) => <EntryLine entry={entry.entry} />,
  "tool-call": (entry) => <ToolCallRow entry={entry} />,
  thinking: (entry) => <ThinkingRow entry={entry} />,
  "task-event": (entry) => <TaskEventRow entry={entry} />,
  segment: (entry) => (
    <span className={styles.segmentLabel}>{entry.label}</span>
  ),
};

function rowBody(entry: TranscriptEntry): ReactNode {
  // The table is total over the union; the cast tells TypeScript the key and the entry agree.
  return (ROW[entry.kind] as (entry: TranscriptEntry) => ReactNode)(entry);
}

function TranscriptRow({
  entry,
  showClock,
}: {
  entry: TranscriptEntry;
  showClock: boolean;
}) {
  const rowClass = entry.kind === "segment" ? styles.segmentRow : styles.row;

  return (
    <li className={rowClass} data-entry={entry.kind}>
      {showClock && (
        <time className={styles.time} dateTime={entry.at}>
          {clockTime(entry.at)}
        </time>
      )}
      <div className={styles.body}>{rowBody(entry)}</div>
    </li>
  );
}

function ConversationList({
  entries,
}: {
  entries: readonly TranscriptEntry[];
}) {
  const shown = clockShown(entries);

  return (
    <ol className={styles.terminal} data-transcript>
      {entries.map((entry, index) => (
        <TranscriptRow key={index} entry={entry} showClock={shown[index]} />
      ))}
    </ol>
  );
}

export function TranscriptTurnsList({
  show,
  entries,
}: {
  show: boolean;
  entries: readonly TranscriptEntry[];
}) {
  if (!show) {
    return null;
  }

  return <ConversationList entries={entries} />;
}
