"use client";

// The graph half of RunVisualizationPanel: connection chip, the graph itself, and the definition/run toggle. Prop-driven, no state or IO of its own (DDAU).
import type { AssemblyLineDefinition } from "@/lib/assembly-line-definition";
import RunGraphView from "@/components/RunGraphView";
import styles from "./RunVisualizationPanel.module.css";
import {
  connectionLabel,
  endedLabel,
  type ChipState,
} from "@/lib/run-stream-presenter";

/** The run as a picture: the connection chip, the graph itself, and the definition/run toggle. */
interface RunGraphSectionProps {
  chipState: ChipState;
  /** How the run ended, read on the chip once it has; null while it runs. */
  runOutcome: string | null;
  /** Why the run is where it is, shown when no step ran. */
  reason: string | null;
  graph: Parameters<typeof RunGraphView>[0]["graph"];
  definition: AssemblyLineDefinition | null;
  onSelectNode: (nodeId: string) => void;
  selectedNodeId: string | null;
  nodeMeta: Readonly<Record<string, string>>;
  hasRunData: boolean;
  showOutcomes: boolean;
  onToggleOutcomes: () => void;
}

export function RunGraphSection(props: RunGraphSectionProps) {
  return (
    <>
      <ConnectionChip state={props.chipState} outcome={props.runOutcome} />
      <RunGraphView
        graph={props.graph}
        definition={props.definition}
        onSelectNode={props.onSelectNode}
        selectedNodeId={props.selectedNodeId}
        nodeMeta={props.nodeMeta}
      />
      <GraphFooter {...props} />
    </>
  );
}

type GraphFooterProps = Pick<
  RunGraphSectionProps,
  "hasRunData" | "showOutcomes" | "onToggleOutcomes" | "reason"
>;

/** Under the graph: the definition/run toggle once a step ran, else the note that none did. */
function GraphFooter(props: GraphFooterProps) {
  return props.hasRunData ? (
    <OutcomesToggle
      showOutcomes={props.showOutcomes}
      onToggle={props.onToggleOutcomes}
    />
  ) : (
    <EmptyRunNote reason={props.reason} />
  );
}

/** A run with no step recorded is drawn as its definition; saying so, with the run's reason, keeps a run that did nothing from reading as a page that lost its data. */
function EmptyRunNote({ reason }: { reason: string | null }) {
  return (
    <p role="note" className={styles.emptyRun}>
      No step ran in this run.{reason ? ` ${reason}` : ""}
    </p>
  );
}

interface OutcomesToggleProps {
  showOutcomes: boolean;
  onToggle: () => void;
}

/** "Show possible outcomes" only makes sense once there is an executed path to toggle away from. */
export function OutcomesToggle({
  showOutcomes,
  onToggle,
}: OutcomesToggleProps) {
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

interface ConnectionChipProps {
  state: ChipState;
  outcome: string | null;
}

/** How the page is currently receiving events, or how the run ended once nothing live is left. A live region rather than plain text: the transport can change under the reader — a dropped stream falls back to polling — and that is worth announcing rather than silently swapping. */
function ConnectionChip({ state, outcome }: ConnectionChipProps) {
  return (
    <div className={styles.header}>
      <span
        className={`${styles.chip} ${styles[state]}`}
        role="status"
        aria-live="polite"
      >
        {state === "ended" ? endedLabel(outcome) : connectionLabel(state)}
      </span>
    </div>
  );
}
