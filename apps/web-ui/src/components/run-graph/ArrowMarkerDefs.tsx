// The one arrowhead every connector points with; the marker id lives next to the marker so definition and reference cannot drift.
import styles from "./run-graph.module.css";

const ARROW_MARKER_ID = "rgv-arrow";

/** What a connector passes as its `markerEnd`. */
export const ARROW_MARKER_URL = `url(#${ARROW_MARKER_ID})`;

export default function ArrowMarkerDefs() {
  return (
    <defs>
      <marker
        id={ARROW_MARKER_ID}
        markerWidth="9"
        markerHeight="8"
        refX="7"
        refY="4"
        orient="auto-start-reverse"
        markerUnits="userSpaceOnUse"
      >
        <path className={styles.arrowHead} d="M1 1 L7 4 L1 7 L2.6 4 Z" />
      </marker>
    </defs>
  );
}
