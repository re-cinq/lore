// Pure file-attention heatmap: a read/write tally in, a ranked bar list out. No
// fetch, no EventSource, no timers — the Panel above owns the reducer state and
// the show-all flag (lore/no-io-in-view). The reducer has already aggregated the
// tally per path; this view only ranks, weights, and truncates for display.

import {
  aggregateFileTouches,
  hiddenTouchCount,
  stripWorkspacePrefix,
  truncateMiddle,
  type FileTouch,
  type TouchCounts,
} from "@/lib/file-heatmap";
import styles from "./FileHeatmapView.module.css";

/** Bars shown before the reader asks for the rest. */
const TOP_N = 30;

/** Longest displayed path before middle-truncation. */
const PATH_MAX = 48;

export interface FileHeatmapViewProps {
  touches: Record<string, TouchCounts>;
  showAll: boolean;
  onToggleShowAll: () => void;
}

function Bar({ touch }: { touch: FileTouch }) {
  return (
    <li className={styles.row} data-path={touch.path}>
      <span className={styles.path} title={stripWorkspacePrefix(touch.path)}>
        {truncateMiddle(stripWorkspacePrefix(touch.path), PATH_MAX)}
      </span>
      <span className={styles.bar} aria-hidden="true">
        <span
          className={styles.fill}
          data-fill
          style={{ ["--fill-width" as string]: `${touch.weight * 100}%` }}
        >
          <span
            className={styles.read}
            style={{ ["--read-share" as string]: touch.reads }}
          />
          <span
            className={styles.write}
            style={{ ["--write-share" as string]: touch.writes }}
          />
        </span>
      </span>
      <span className={styles.counts}>
        <span className={styles.readCount}>{touch.reads} read</span>
        <span className={styles.writeCount}>{touch.writes} write</span>
      </span>
    </li>
  );
}

export default function FileHeatmapView({
  touches,
  showAll,
  onToggleShowAll,
}: FileHeatmapViewProps) {
  const ranked = aggregateFileTouches(touches, showAll ? undefined : TOP_N);
  const hidden = hiddenTouchCount(touches, TOP_N);

  if (ranked.length === 0) {
    return <p className={styles.empty}>No files touched yet.</p>;
  }

  return (
    <div className={styles.heatmap}>
      <ol className={styles.rows}>
        {ranked.map((touch) => (
          <Bar key={touch.path} touch={touch} />
        ))}
      </ol>
      {showAll || hidden > 0 ? (
        <button
          type="button"
          className={styles.toggle}
          onClick={onToggleShowAll}
        >
          {showAll ? "Show fewer" : `Show ${hidden} more`}
        </button>
      ) : null}
    </div>
  );
}
