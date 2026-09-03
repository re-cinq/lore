// A node with nothing to report: just its name, centered — plus "Terminal" when the step is where the walk ends.
import styles from "./run-graph.module.css";

export interface NodePlainLabelProps {
  title: string;
  centerX: number;
  centerY: number;
  isTerminal: boolean;
}

export default function NodePlainLabel({
  title,
  centerX,
  centerY,
  isTerminal,
}: NodePlainLabelProps) {
  return (
    <>
      <text
        className={styles.nodeId}
        x={centerX}
        y={isTerminal ? centerY - 4 : centerY + 4}
        textAnchor="middle"
      >
        {title}
      </text>
      {isTerminal ? (
        <text
          className={styles.nodeStatus}
          x={centerX}
          y={centerY + 12}
          textAnchor="middle"
        >
          Terminal
        </text>
      ) : null}
    </>
  );
}
