"use client";

// The graph half of RunVisualizationPanel: connection chip, the graph itself, the definition/run toggle, and the replay scrubber. Prop-driven, no state or IO of its own (DDAU).
import type { AssemblyLineDefinition } from "@/lib/assembly-line-definition";
import ReplayScrubberView from "./ReplayScrubberView";
import RunGraphView from "./RunGraphView";
import styles from "./RunVisualizationPanel.module.css";
import { connectionLabel } from "./run-stream-presenter";

/** "Show possible outcomes" only makes sense once there is an executed path to toggle away from. */
export function OutcomesToggle({
  show,
  showOutcomes,
  onToggle,
}: {
  show: boolean;
  showOutcomes: boolean;
  onToggle: () => void;
}) {
  if (!show) {
    return null;
  }

  return (
    <button
      type="button"
      className={styles.outcomesToggle}
      aria-pressed={showOutcomes}
      onClick={onToggle}
    >
      {showOutcomes ? "Show executed path" : "Show possible outcomes"}
    </button>
  );
}

/** Scrub back through a finished run's events, and the way back to its end. */
function ReplayControls({
  eventCount,
  cursor,
  position,
  onCursorChange,
  onBackToLive,
}: {
  eventCount: number;
  cursor: number;
  position: { label: string; timestamp: string | null };
  onCursorChange: (cursor: number) => void;
  onBackToLive: () => void;
}) {
  return (
    <div className={styles.replayControls}>
      <ReplayScrubberView
        eventCount={eventCount}
        cursor={cursor}
        label={position.label}
        timestamp={position.timestamp}
        onCursorChange={onCursorChange}
      />
      <button
        type="button"
        className={styles.backToLive}
        onClick={onBackToLive}
      >
        Back to live
      </button>
    </div>
  );
}

/** The replay scrubber, shown only once a finished run has history to scrub through. */
export function ReplayControlsSlot({
  show,
  historyEventCount,
  replayCursor,
  position,
  onCursorChange,
  onBackToLive,
}: {
  show: boolean;
  historyEventCount: number;
  replayCursor: number | null;
  position: { label: string; timestamp: string | null };
  onCursorChange: (cursor: number) => void;
  onBackToLive: () => void;
}) {
  if (!show) {
    return null;
  }

  return (
    <ReplayControls
      eventCount={historyEventCount}
      cursor={replayCursor ?? historyEventCount}
      position={position}
      onCursorChange={onCursorChange}
      onBackToLive={onBackToLive}
    />
  );
}

/** The run as a picture: the connection chip, the graph itself, the definition/run toggle, and the scrubber for a finished run. */
export function RunGraphSection({
  chipState,
  graph,
  definition,
  onSelectNode,
  hasRunData,
  showOutcomes,
  onToggleOutcomes,
  replay,
}: {
  chipState: Parameters<typeof connectionLabel>[0];
  graph: Parameters<typeof RunGraphView>[0]["graph"];
  definition: AssemblyLineDefinition | null;
  onSelectNode: (nodeId: string) => void;
  hasRunData: boolean;
  showOutcomes: boolean;
  onToggleOutcomes: () => void;
  replay: {
    show: boolean;
    historyEventCount: number;
    cursor: number | null;
    position: { label: string; timestamp: string | null };
    onCursorChange: (cursor: number) => void;
    onBackToLive: () => void;
  };
}) {
  return (
    <>
      <div className={styles.header}>
        <span
          className={`${styles.chip} ${styles[chipState]}`}
          role="status"
          aria-live="polite"
        >
          {connectionLabel(chipState)}
        </span>
      </div>
      <RunGraphView
        graph={graph}
        definition={definition}
        onSelectNode={onSelectNode}
      />
      <OutcomesToggle
        show={hasRunData}
        showOutcomes={showOutcomes}
        onToggle={onToggleOutcomes}
      />
      <ReplayControlsSlot
        show={replay.show}
        historyEventCount={replay.historyEventCount}
        replayCursor={replay.cursor}
        position={replay.position}
        onCursorChange={replay.onCursorChange}
        onBackToLive={replay.onBackToLive}
      />
    </>
  );
}
