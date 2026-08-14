// One step in the graph: the box, its keyboard/pointer selection, and whichever
// body has something to say — a run verdict, the outcomes the step can produce,
// or just its name. The three bodies are exclusive, so the choice is made once
// here and the aria-label follows the same order.

import type { LayoutNode } from "@/lib/dag-layout";
import type { GraphMode, VisibleNode } from "@/lib/graph-view-model";
import {
  nodeRunVisual,
  outcomeVisual,
  resultVisual,
  type NodeStatusVisual,
} from "@/lib/run-node-status";
import NodeOutcomeList from "./NodeOutcomeList";
import NodePlainLabel from "./NodePlainLabel";
import NodeRunBadge from "./NodeRunBadge";
import { NODE_WIDTH, titleCase } from "./run-graph-geometry";
import { classes } from "./run-graph-tone-classes";
import styles from "./run-graph.module.css";

export interface GraphNodeProps {
  node: LayoutNode;
  /** The view model for this node, absent when the layout carries a node the
   *  visible graph does not. */
  model: VisibleNode | undefined;
  mode: GraphMode;
  height: number;
  isTerminal: boolean;
  onSelect?: (nodeId: string) => void;
}

/** The run-mode badge for a node: the terminal shows the run result, an executed
 *  node its verdict, and an in-flight one "Running". */
function runBadge(node: VisibleNode): NodeStatusVisual {
  if (node.result !== null) {
    return resultVisual(node.result);
  }

  return nodeRunVisual(node.verdict, node.status, node.signal);
}

/** The node read aloud: whatever its body shows, in words. */
function nodeAriaLabel(
  nodeId: string,
  badge: NodeStatusVisual | null,
  outcomes: readonly string[],
  isTerminal: boolean,
): string {
  if (badge) {
    return `${nodeId} — ${badge.label}`;
  }

  if (outcomes.length > 0) {
    const labels = outcomes.map((on) => outcomeVisual(on).label).join(", ");

    return `${nodeId}, possible outcomes: ${labels}`;
  }

  return isTerminal ? `${nodeId} — Terminal` : nodeId;
}

export default function GraphNode({
  node,
  model,
  mode,
  height,
  isTerminal,
  onSelect,
}: GraphNodeProps) {
  const badge = mode === "run" && model ? runBadge(model) : null;
  const outcomes = model?.outcomes ?? [];
  const top = node.y - height / 2;
  const leftEdge = node.x - NODE_WIDTH / 2;
  const title = titleCase(node.id);
  const interactive = onSelect !== undefined;

  function body() {
    if (badge) {
      return (
        <NodeRunBadge
          title={title}
          badge={badge}
          leftEdge={leftEdge}
          centerY={node.y}
        />
      );
    }

    if (outcomes.length > 0) {
      return (
        <NodeOutcomeList
          title={title}
          outcomes={outcomes}
          leftEdge={leftEdge}
          top={top}
        />
      );
    }

    return (
      <NodePlainLabel
        title={title}
        centerX={node.x}
        centerY={node.y}
        isTerminal={isTerminal}
      />
    );
  }

  return (
    <g
      className={classes(styles.node, badge ? styles[badge.tone] : undefined)}
      data-node={node.id}
      data-tone={badge?.tone ?? "idle"}
      role={interactive ? "button" : "group"}
      aria-label={nodeAriaLabel(node.id, badge, outcomes, isTerminal)}
      tabIndex={interactive ? 0 : undefined}
      onClick={interactive ? () => onSelect(node.id) : undefined}
      onKeyDown={
        interactive
          ? (event) => {
              if (event.key !== "Enter" && event.key !== " ") {
                return;
              }

              event.preventDefault();
              onSelect(node.id);
            }
          : undefined
      }
    >
      <rect
        className={styles.box}
        x={leftEdge}
        y={top}
        width={NODE_WIDTH}
        height={height}
        rx={10}
      />
      {body()}
    </g>
  );
}
