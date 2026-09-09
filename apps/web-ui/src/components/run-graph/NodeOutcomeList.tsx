// Definition mode inside a node box: outcomes live here (one glyph-and-label row each) because the connector carrying them collapsed into a single hop.
import { outcomeTone } from "@/lib/graph-view-model";
import { outcomeVisual } from "@/lib/run-node-status";
import StatusIcon from "./StatusIcon";
import { OUTCOME_ROW } from "./run-graph-geometry";
import { classes, textFillClass } from "./run-graph-tone-classes";
import styles from "./run-graph.module.css";

export interface NodeOutcomeListProps {
  title: string;
  outcomes: readonly string[];
  /** Left edge and top of the node box; the rows lay themselves out from there. */
  leftEdge: number;
  top: number;
}

interface OutcomeRowProps {
  outcome: string;
  leftEdge: number;
  rowY: number;
}

/** One declared outcome: its tone as an icon AND as the text fill, so the distinction survives for a reader who cannot separate the colours. `data-outcome` carries the raw name for tests, which should not have to read a humanized label. */
function OutcomeRow({ outcome, leftEdge, rowY }: OutcomeRowProps) {
  const tone = outcomeTone(outcome);

  return (
    <g data-outcome={outcome}>
      <StatusIcon tone={tone} cx={leftEdge + 22} cy={rowY - 4} r={6} />
      <text
        className={classes(styles.outcomeRow, textFillClass(tone))}
        x={leftEdge + 34}
        y={rowY}
        textAnchor="start"
      >
        {outcomeVisual(outcome).label}
      </text>
    </g>
  );
}

interface HeadingLineProps {
  className: string;
  leftEdge: number;
  textY: number;
  label: string;
}

function HeadingLine({ className, leftEdge, textY, label }: HeadingLineProps) {
  return (
    <text className={className} x={leftEdge + 16} y={textY} textAnchor="start">
      {label}
    </text>
  );
}

interface ListHeadingProps {
  title: string;
  leftEdge: number;
  top: number;
}

/** The node's name and the "Possible outcomes:" caption above the list. The caption is explicit because these are what COULD happen, not what did — an unlabelled list of verdicts on a node that has not run reads as results. */
function ListHeading({ title, leftEdge, top }: ListHeadingProps) {
  return (
    <>
      <HeadingLine
        className={styles.nodeId}
        leftEdge={leftEdge}
        textY={top + 22}
        label={title}
      />
      <HeadingLine
        className={styles.possibleLabel}
        leftEdge={leftEdge}
        textY={top + 38}
        label="Possible outcomes:"
      />
    </>
  );
}

export default function NodeOutcomeList({
  title,
  outcomes,
  leftEdge,
  top,
}: NodeOutcomeListProps) {
  return (
    <>
      <ListHeading title={title} leftEdge={leftEdge} top={top} />
      {outcomes.map((outcome, index) => (
        <OutcomeRow
          key={outcome}
          outcome={outcome}
          leftEdge={leftEdge}
          rowY={top + 55 + index * OUTCOME_ROW}
        />
      ))}
    </>
  );
}
