// The facts line under a run-mode node's verdict: model, duration, visit count — drawn only when there is something to say.
import { fitNodeLabel } from "./run-graph-geometry";
import styles from "./run-graph.module.css";

export interface NodeMetaLineProps {
  meta: string;
  leftEdge: number;
  centerY: number;
  /** This line's baseline, as an offset from the box centre (`nodeTextRows`). */
  baseline: number;
}

const attrs = (leftEdge: number, baselineY: number) => ({
  className: styles.nodeMeta,
  "data-meta": true,
  x: leftEdge + 40,
  y: baselineY,
  textAnchor: "start" as const,
});

export default function NodeMetaLine(props: NodeMetaLineProps) {
  const { meta, leftEdge, centerY, baseline } = props;

  if (meta === "") {
    return null;
  }

  return (
    <text {...attrs(leftEdge, centerY + baseline)}>
      <title>{meta}</title>
      {fitNodeLabel(meta)}
    </text>
  );
}
