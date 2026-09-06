// Run mode inside a node box: a status glyph, the step's name, and the verdict spelled out underneath it.
import type { NodeStatusVisual } from "@/lib/run-node-status";
import StatusIcon from "./StatusIcon";
import { fitNodeLabel } from "./run-graph-geometry";
import { classes, textFillClass } from "./run-graph-tone-classes";
import styles from "./run-graph.module.css";

export interface NodeRunBadgeProps {
  title: string;
  badge: NodeStatusVisual;
  /** Left edge of the node box; the badge lays itself out from there. */
  leftEdge: number;
  centerY: number;
}

// Hover title ONLY when drawing cost characters — a tooltip repeating on-screen text is noise and doubles it in the a11y tree.
function fitted(text: string) {
  const shown = fitNodeLabel(text);

  return { shown, full: shown === text ? null : text };
}

export default function NodeRunBadge({
  title,
  badge,
  leftEdge,
  centerY,
}: NodeRunBadgeProps) {
  const name = fitted(title);
  const verdict = fitted(badge.label);

  return (
    <>
      <StatusIcon tone={badge.tone} cx={leftEdge + 24} cy={centerY} />
      <text
        className={styles.nodeId}
        x={leftEdge + 40}
        y={centerY - 2}
        textAnchor="start"
      >
        {name.full && <title>{name.full}</title>}
        {name.shown}
      </text>
      <text
        className={classes(styles.statusLabel, textFillClass(badge.tone))}
        x={leftEdge + 40}
        y={centerY + 13}
        textAnchor="start"
      >
        {verdict.full && <title>{verdict.full}</title>}
        {verdict.shown}
      </text>
    </>
  );
}
