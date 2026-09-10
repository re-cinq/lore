// Pure file-attention heatmap (lore/no-io-in-view) — the Panel above owns fetch/reducer state; this view only ranks, weights, and truncates.
import CollapsibleCard from "@/components/CollapsibleCard";
import {
  aggregateFileTouches,
  remainderTouchCount,
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
  /** When given, each bar is a button that opens that file's diff (FR8.6). */
  onOpenFile?: (path: string) => void;
  /** The file whose diff is open, so its bar reads as pressed. */
  activePath?: string | null;
}

interface HeatmapBarsProps extends FileHeatmapViewProps {
  ranked: FileTouch[];
  hidden: number;
}

export default function FileHeatmapView(props: FileHeatmapViewProps) {
  const { touches, showAll } = props;
  const ranked = aggregateFileTouches(touches, showAll ? undefined : TOP_N);
  const hidden = remainderTouchCount(touches, TOP_N);

  return (
    <CollapsibleCard
      title="Files touched"
      defaultOpen
      emptyState="No files touched yet."
    >
      {ranked.length === 0 ? null : (
        <HeatmapBars {...props} ranked={ranked} hidden={hidden} />
      )}
    </CollapsibleCard>
  );
}

function HeatmapBars(props: HeatmapBarsProps) {
  const { ranked, showAll, hidden, onOpenFile, activePath } = props;

  return (
    <div className={styles.heatmap}>
      <ol className={styles.rows}>
        {ranked.map((touch) => (
          <Bar
            key={touch.path}
            touch={touch}
            onOpenFile={onOpenFile}
            active={touch.path === activePath}
          />
        ))}
      </ol>
      {showAll || hidden > 0 ? <ShowMoreToggle {...props} /> : null}
    </div>
  );
}

interface BarProps {
  touch: FileTouch;
  onOpenFile?: (path: string) => void;
  active: boolean;
}

/** A plain row, or — when the heatmap can open diffs — a button carrying the same `data-path`. */
function Bar({ touch, onOpenFile, active }: BarProps) {
  if (!onOpenFile) {
    return (
      <li className={styles.row} data-path={touch.path}>
        <BarContent touch={touch} />
      </li>
    );
  }

  return (
    <li>
      <BarButton touch={touch} onOpenFile={onOpenFile} active={active} />
    </li>
  );
}

function ShowMoreToggle({
  showAll,
  hidden,
  onToggleShowAll,
}: HeatmapBarsProps) {
  return (
    <button type="button" className={styles.toggle} onClick={onToggleShowAll}>
      {showAll ? "Show fewer" : `Show ${hidden} more`}
    </button>
  );
}

function BarButton({ touch, onOpenFile, active }: Required<BarProps>) {
  return (
    <button
      type="button"
      className={`${styles.row} ${styles.rowButton}`}
      data-path={touch.path}
      aria-pressed={active}
      onClick={() => onOpenFile(touch.path)}
    >
      <BarContent touch={touch} />
    </button>
  );
}

function BarContent({ touch }: { touch: FileTouch }) {
  return (
    <>
      <span className={styles.path} title={stripWorkspacePrefix(touch.path)}>
        {truncateMiddle(stripWorkspacePrefix(touch.path), PATH_MAX)}
      </span>
      <span className={styles.bar} aria-hidden="true">
        <BarFill touch={touch} />
      </span>
      <span className={styles.counts}>
        <span className={styles.readCount}>{touch.reads} read</span>
        <span className={styles.writeCount}>{touch.writes} write</span>
      </span>
    </>
  );
}

function BarFill({ touch }: { touch: FileTouch }) {
  return (
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
  );
}
