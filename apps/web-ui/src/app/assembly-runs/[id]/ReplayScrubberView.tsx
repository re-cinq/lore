// Pure scrub control (lore/no-io-in-view) — Panel owns the history array; keyboard is reimplemented on onKeyDown since jsdom's range has no arrow/Home/End behavior.
import type { KeyboardEvent } from "react";
import styles from "./ReplayScrubberView.module.css";

export interface ReplayScrubberViewProps {
  eventCount: number;
  cursor: number;
  label: string;
  timestamp: string | null;
  onCursorChange: (cursor: number) => void;
}

/** Where a key press moves the cursor, or null for a key this scrubber does not handle. Returning null rather than acting is what lets the caller leave the event alone — preventing default on every key would swallow Tab and the browser's own shortcuts. */
function seekTarget(
  key: string,
  cursor: number,
  eventCount: number,
): number | null {
  switch (key) {
    case "ArrowRight":
      return cursor + 1;
    case "ArrowLeft":
      return cursor - 1;
    case "Home":
      return 0;
    case "End":
      return eventCount;
    default:
      return null;
  }
}

/** Arrow keys step one event, Home and End jump to the ends. Every handled key is clamped and consumed; anything else falls through untouched. */
function keyboardSeek({
  cursor,
  eventCount,
  clamp,
  onCursorChange,
}: {
  cursor: number;
  eventCount: number;
  clamp: (value: number) => number;
  onCursorChange: (cursor: number) => void;
}) {
  return (event: KeyboardEvent<HTMLInputElement>) => {
    const target = seekTarget(event.key, cursor, eventCount);

    if (target === null) {
      return;
    }

    event.preventDefault();
    onCursorChange(clamp(target));
  };
}

interface ScrubberSliderProps {
  eventCount: number;
  cursor: number;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onSeek: (value: number) => void;
}

function ScrubberSlider({
  eventCount,
  cursor,
  onKeyDown,
  onSeek,
}: ScrubberSliderProps) {
  return (
    <input
      className={styles.slider}
      type="range"
      min={0}
      max={eventCount}
      value={cursor}
      aria-label="Replay position"
      onKeyDown={onKeyDown}
      onChange={(event) => onSeek(Number(event.target.value))}
    />
  );
}

interface ScrubberPositionProps {
  label: string;
  timestamp: string | null;
}

function ScrubberPosition({ label, timestamp }: ScrubberPositionProps) {
  return (
    <output className={styles.position}>
      <span>{label}</span>
      {timestamp ? <time dateTime={timestamp}>{timestamp}</time> : null}
    </output>
  );
}

export default function ReplayScrubberView(props: ReplayScrubberViewProps) {
  const { eventCount, cursor, label, timestamp, onCursorChange } = props;
  const clamp = (value: number) => Math.max(0, Math.min(value, eventCount));
  const onKeyDown = keyboardSeek({ cursor, eventCount, clamp, onCursorChange });

  return (
    <div className={styles.scrubber}>
      <ScrubberSlider
        eventCount={eventCount}
        cursor={cursor}
        onKeyDown={onKeyDown}
        onSeek={(value) => onCursorChange(clamp(value))}
      />
      <ScrubberPosition label={label} timestamp={timestamp} />
    </div>
  );
}
