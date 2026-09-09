// A node with nothing to report: just its name, centered — plus "Terminal" when the step is where the walk ends.
import styles from "./run-graph.module.css";

export interface NodePlainLabelProps {
  title: string;
  centerX: number;
  centerY: number;
  isTerminal: boolean;
}

interface CenteredTextProps {
  className: string;
  centerX: number;
  textY: number;
  label: string;
}

function CenteredText({ className, centerX, textY, label }: CenteredTextProps) {
  return (
    <text className={className} x={centerX} y={textY} textAnchor="middle">
      {label}
    </text>
  );
}

// The second line a terminal node carries, under its name.
function TerminalCaption({ centerX, centerY }: NodePlainLabelProps) {
  return (
    <CenteredText
      className={styles.nodeStatus}
      centerX={centerX}
      textY={centerY + 12}
      label="Terminal"
    />
  );
}

export default function NodePlainLabel(props: NodePlainLabelProps) {
  const { title, centerX, centerY, isTerminal } = props;

  return (
    <>
      <CenteredText
        className={styles.nodeId}
        centerX={centerX}
        textY={isTerminal ? centerY - 4 : centerY + 4}
        label={title}
      />
      {isTerminal ? <TerminalCaption {...props} /> : null}
    </>
  );
}
