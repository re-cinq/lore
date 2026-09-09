"use client";

// The graph half of RunVisualizationPanel: connection chip, the graph itself, and the definition/run toggle. Prop-driven, no state or IO of its own (DDAU).
import type { AssemblyLineDefinition } from "@/lib/assembly-line-definition";
import RunGraphView from "@/components/RunGraphView";
import styles from "./RunVisualizationPanel.module.css";
import { connectionLabel } from "@/lib/run-stream-presenter";

interface OutcomesToggleProps {
  show: boolean;
  showOutcomes: boolean;
  onToggle: () => void;
}

/** "Show possible outcomes" only makes sense once there is an executed path to toggle away from. */
export function OutcomesToggle({
  show,
  showOutcomes,
  onToggle,
}: OutcomesToggleProps) {
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

/** The run as a picture: the connection chip, the graph itself, and the definition/run toggle. */
interface RunGraphSectionProps {
  chipState: Parameters<typeof connectionLabel>[0];
  graph: Parameters<typeof RunGraphView>[0]["graph"];
  definition: AssemblyLineDefinition | null;
  onSelectNode: (nodeId: string) => void;
  hasRunData: boolean;
  showOutcomes: boolean;
  onToggleOutcomes: () => void;
}

interface ConnectionChipProps {
  state: RunGraphSectionProps["chipState"];
}

/** How the page is currently receiving events. A live region rather than plain text: the transport can change under the reader — a dropped stream falls back to polling — and that is worth announcing rather than silently swapping. */
function ConnectionChip({ state }: ConnectionChipProps) {
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
    </>
  );
}
