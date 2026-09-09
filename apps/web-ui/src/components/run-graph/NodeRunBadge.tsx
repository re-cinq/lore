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
  /** Baselines of the name and the verdict, as offsets from the box centre (`nodeTextRows`). */
  baselines: readonly number[];
}

// Hover title ONLY when drawing cost characters — a tooltip repeating on-screen text is noise and doubles it in the a11y tree.
function fitted(text: string) {
  const shown = fitNodeLabel(text);

  return { shown, full: shown === text ? null : text };
}

/** Text clipped to the node box, with the untruncated value as a `<title>` so hovering still gives the whole thing. SVG text neither wraps nor ellipsizes on its own, so a long node id would otherwise run straight out of its box and across the graph. */
function FittedText({
  className,
  textX,
  textY,
  text,
}: {
  className: string;
  textX: number;
  textY: number;
  text: string;
}) {
  const { shown, full } = fitted(text);

  return (
    <text className={className} x={textX} y={textY} textAnchor="start">
      {full && <title>{full}</title>}
      {shown}
    </text>
  );
}

function NodeTitleLabel({
  title,
  leftEdge,
  centerY,
  baselines,
}: NodeRunBadgeProps) {
  return (
    <FittedText
      className={styles.nodeId}
      textX={leftEdge + 40}
      textY={centerY + baselines[0]}
      text={title}
    />
  );
}

// The verdict spelled out under the name, tinted with the same tone as the glyph.
function NodeVerdictLabel({
  badge,
  leftEdge,
  centerY,
  baselines,
}: NodeRunBadgeProps) {
  return (
    <FittedText
      className={classes(styles.statusLabel, textFillClass(badge.tone))}
      textX={leftEdge + 40}
      textY={centerY + baselines[1]}
      text={badge.label}
    />
  );
}

export default function NodeRunBadge(props: NodeRunBadgeProps) {
  const { badge, leftEdge, centerY } = props;

  return (
    <>
      <StatusIcon tone={badge.tone} cx={leftEdge + 24} cy={centerY} />
      <NodeTitleLabel {...props} />
      <NodeVerdictLabel {...props} />
    </>
  );
}
