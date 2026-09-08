"use client";

// The graph half of RunVisualizationPanel: connection chip, the graph itself, the definition/run toggle, and the replay scrubber. Prop-driven, no state or IO of its own (DDAU).
import type { AssemblyLineDefinition } from "@/lib/assembly-line-definition";
import ReplayScrubberView from "./ReplayScrubberView";
import RunGraphView from "@/components/RunGraphView";
import styles from "./RunVisualizationPanel.module.css";
import { connectionLabel } from "@/lib/run-stream-presenter";

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

interface ReplayControlsProps {
  eventCount: number;
  cursor: number;
  position: { label: string; timestamp: string | null };
  onCursorChange: (cursor: number) => void;
  onBackToLive: () => void;
}

/** Scrub back through a finished run's events, and the way back to its end. */
function ReplayControls({
  eventCount,
  cursor,
  position,
  onCursorChange,
  onBackToLive,
}: ReplayControlsProps) {
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
interface RunGraphSectionProps {
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
}

/** How the page is currently receiving events. A live region rather than plain text: the transport can change under the reader — a dropped stream falls back to polling — and that is worth announcing rather than silently swapping. */
function ConnectionChip({
  state,
}: {
  state: RunGraphSectionProps["chipState"];
}) {
  return (
    <div className={styles.header}>
      <span
        className={`${styles.chip} ${styles[state]}`}
        role="status"
        aria-live="polite"
      >
        {connectionLabel(state)}
      </span>
    </div>
  );
}

export function RunGraphSection(props: RunGraphSectionProps) {
  const { replay } = props;

  return (
    <>
      <ConnectionChip state={props.chipState} />
      <RunGraphView
        graph={props.graph}
        definition={props.definition}
        onSelectNode={props.onSelectNode}
      />
      <OutcomesToggle
        show={props.hasRunData}
        showOutcomes={props.showOutcomes}
        onToggle={props.onToggleOutcomes}
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
