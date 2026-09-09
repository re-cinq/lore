import type { AgentRunTurn } from "@/lib/run-turn-types";
import {
  clockTime,
  envelopePretty,
  turnHeading,
  type TimedLogEntry,
} from "./turn-transcript-presenter";
import { EntryLine } from "@/components/LogEntriesView";
import { LogFormatToggleRow } from "@/components/LogFormatToggle";
import styles from "./FullTranscriptPanel.module.css";

export interface NodeSegmentView {
  label: string | null;
  entries: TimedLogEntry[];
}

// Loading… only once the card has actually been opened; a closed card shows nothing while resp is still null.
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

interface TranscriptToggleRowProps {
  show: boolean;
  showRaw: boolean;
  setShowRaw: (raw: boolean) => void;
}

export function TranscriptToggleRow({
  show,
  showRaw,
  setShowRaw,
}: TranscriptToggleRowProps) {
  if (!show) {
    return null;
  }

  return (
    <LogFormatToggleRow
      className={styles.toggleRow}
      showRaw={showRaw}
      setShowRaw={setShowRaw}
    />
  );
}

function RawTurnItem({ turn }: { turn: AgentRunTurn }) {
  return (
    <li className={styles.turn}>
      <details>
        <summary className={styles.turnSummary}>
          <span className={styles.kind}>{turnHeading(turn)}</span>
          {turn.iteration !== null && (
            <span className={styles.iteration}>iteration {turn.iteration}</span>
          )}
          <time dateTime={turn.createdAt}>
            {new Date(turn.createdAt).toLocaleString()}
          </time>
        </summary>
        <pre className={styles.envelope}>{envelopePretty(turn)}</pre>
      </details>
    </li>
  );
}

function RawTurnsList({ turns }: { turns: AgentRunTurn[] }) {
  return (
    <ol className={styles.turns}>
      {turns.map((turn) => (
        <RawTurnItem key={turn.id} turn={turn} />
      ))}
    </ol>
  );
}

function SegmentEntry({
  timed,
}: {
  timed: NodeSegmentView["entries"][number];
}) {
  return (
    <li className={styles.entryRow}>
      <time className={styles.entryTime} dateTime={timed.at}>
        {clockTime(timed.at)}
      </time>
      <div className={styles.entryBody}>
        <EntryLine entry={timed.entry} />
      </div>
    </li>
  );
}

function SegmentItem({ segment }: { segment: NodeSegmentView }) {
  return (
    <li className={styles.segment}>
      {segment.label !== null && (
        <div className={styles.segmentHeader}>{segment.label}</div>
      )}
      <ol className={styles.entries}>
        {segment.entries.map((timed, i) => (
          <SegmentEntry key={i} timed={timed} />
        ))}
      </ol>
    </li>
  );
}

function SegmentedTurnsList({ segments }: { segments: NodeSegmentView[] }) {
  return (
    <ol className={styles.segments}>
      {segments.map((segment, index) => (
        <SegmentItem key={index} segment={segment} />
      ))}
    </ol>
  );
}

export function TranscriptTurnsList({
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
