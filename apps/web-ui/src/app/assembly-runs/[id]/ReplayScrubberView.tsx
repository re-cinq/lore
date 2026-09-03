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

export default function ReplayScrubberView({
  eventCount,
  cursor,
  label,
  timestamp,
  onCursorChange,
}: ReplayScrubberViewProps) {
  const clamp = (value: number) => Math.max(0, Math.min(value, eventCount));

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const step = (delta: number) => {
      event.preventDefault();
      onCursorChange(clamp(cursor + delta));
    };

    if (event.key === "ArrowRight") {
      step(1);

      return;
    }

    if (event.key === "ArrowLeft") {
      step(-1);

      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      onCursorChange(0);

      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      onCursorChange(eventCount);
    }
  };

  return (
    <div className={styles.scrubber}>
      <input
        className={styles.slider}
        type="range"
        min={0}
        max={eventCount}
        value={cursor}
        aria-label="Replay position"
        onKeyDown={onKeyDown}
        onChange={(event) => onCursorChange(clamp(Number(event.target.value)))}
      />
      <output className={styles.position}>
        <span>{label}</span>
        {timestamp ? <time dateTime={timestamp}>{timestamp}</time> : null}
      </output>
    </div>
  );
}
