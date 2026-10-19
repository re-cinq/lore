// The one arrowhead every connector points with; the marker id lives next to the marker so definition and reference cannot drift.
import styles from "./run-graph.module.css";

const ARROW_MARKER_ID = "rgv-arrow";
// Referenced from the stylesheet as url(#rgv-agent-border); keep the two in step.
const AGENT_BORDER_ID = "rgv-agent-border";

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
      <AgentBorderGradient />
    </defs>
  );
}

/** An AI step's border runs through the palette, so the work a model does reads apart from every other step (run-viz FR4.1h). */
function AgentBorderGradient() {
  return (
    <linearGradient id={AGENT_BORDER_ID} x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" className={styles.agentStopStart} />
      <stop offset="0.5" className={styles.agentStopMiddle} />
      <stop offset="1" className={styles.agentStopEnd} />
    </linearGradient>
  );
}
