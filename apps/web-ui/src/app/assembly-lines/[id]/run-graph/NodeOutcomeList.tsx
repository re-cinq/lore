// Definition mode inside a node box: the step's name over the outcomes it can
// produce, one glyph-and-label row each. They live in the node because the
// connector that carries them collapsed into a single hop.

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

export default function NodeOutcomeList({
  title,
  outcomes,
  leftEdge,
  top,
}: NodeOutcomeListProps) {
  return (
    <>
      <text
        className={styles.nodeId}
        x={leftEdge + 16}
        y={top + 22}
        textAnchor="start"
      >
        {title}
      </text>
      <text
        className={styles.possibleLabel}
        x={leftEdge + 16}
        y={top + 38}
        textAnchor="start"
      >
        Possible outcomes:
      </text>
      {outcomes.map((outcome, index) => {
        const rowY = top + 55 + index * OUTCOME_ROW;
        const tone = outcomeTone(outcome);

        return (
          <g key={outcome} data-outcome={outcome}>
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
      })}
    </>
  );
}
