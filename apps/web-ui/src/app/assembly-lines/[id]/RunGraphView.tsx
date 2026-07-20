// The definition DAG for one run: declarative SVG, no IO, no state.
//
// Declarative rather than imperative (the d3 SpecGraphD3 shell next door is the
// counter-example) so it renders and asserts in jsdom and needs no coverage
// exclusion. Every geometric decision already happened in layoutAssemblyLine —
// this file maps its output to elements and nothing else.

import type { AssemblyLineDefinition } from "@/lib/assembly-line-definition";
import type { LayoutEdge, LayoutNode } from "@/lib/dag-layout";
import { layoutAssemblyLine } from "@/lib/dag-layout";
import type { NodeRunState } from "@/lib/run-event-reducer";
import { nodeStatusVisual } from "@/lib/run-node-status";
import styles from "./RunGraphView.module.css";

const NODE_WIDTH = 132;
const NODE_HEIGHT = 48;
const GUTTER = 80;
const IDLE_STATUS = "idle" as const;

export interface RunGraphViewProps {
  definition: AssemblyLineDefinition | null;
  nodeStates: Record<string, NodeRunState>;
  /** Suppressed for a synthesized graph, whose conditions are a guess. */
  showEdgeLabels?: boolean;
  onSelectNode?: (nodeId: string) => void;
}

/**
 * Attempt ceiling for a node: one more than the largest `iteration_max` on an
 * inbound edge, because the walk fails an edge only once the count exceeds that
 * max (libs/assembly-lines transition.ts). A node no edge limits has no ceiling
 * and therefore no badge.
 */
function attemptCeiling(
  definition: AssemblyLineDefinition,
  nodeId: string,
): number | null {
  const maxima = definition.edges
    .filter((edge) => edge.to === nodeId && edge.iteration_max !== undefined)
    .map((edge) => edge.iteration_max as number);

  return maxima.length === 0 ? null : Math.max(...maxima) + 1;
}

function edgeKey(edge: LayoutEdge): string {
  return `${edge.from}-${edge.to}-${edge.on}`;
}

function labelPoint(
  edge: LayoutEdge,
  byId: Map<string, LayoutNode>,
): { x: number; y: number } | null {
  const from = byId.get(edge.from);
  const to = byId.get(edge.to);

  if (!from || !to) {
    return null;
  }

  if (edge.kind === "self") {
    return { x: from.x, y: from.y - NODE_HEIGHT };
  }

  return { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 - 8 };
}

/** The definition graph with per-node run status. Pure render. */
export default function RunGraphView({
  definition,
  nodeStates,
  showEdgeLabels = true,
  onSelectNode,
}: RunGraphViewProps) {
  if (!definition || definition.nodes.length === 0) {
    return (
      <p className={styles.empty}>
        No assembly-line graph to show for this run.
      </p>
    );
  }

  const layout = layoutAssemblyLine(definition);
  const byId = new Map(layout.nodes.map((node) => [node.id, node]));
  const titleId = `run-graph-title-${definition.name}`;
  const interactive = onSelectNode !== undefined;

  return (
    <section className={styles.figure}>
      <h2 className={styles.heading}>Graph</h2>
      <svg
        className={styles.svg}
        role="img"
        aria-labelledby={titleId}
        viewBox={`0 ${-GUTTER} ${layout.width + GUTTER} ${layout.height + GUTTER}`}
      >
        <title id={titleId}>{`Assembly line ${definition.name}`}</title>

        {layout.edges.map((edge) => {
          const point = showEdgeLabels ? labelPoint(edge, byId) : null;

          return (
            <g key={edgeKey(edge)}>
              <path
                className={[styles.edge, styles[edge.kind]].filter(Boolean).join(' ')}
                data-edge={edgeKey(edge)}
                data-kind={edge.kind}
                d={edge.d}
              />
              {point ? (
                <text
                  className={styles.edgeLabel}
                  x={point.x}
                  y={point.y}
                  textAnchor="middle"
                >
                  {edge.on}
                </text>
              ) : null}
            </g>
          );
        })}

        {layout.nodes.map((node) => {
          const state = nodeStates[node.id];
          const visual = nodeStatusVisual(state?.status ?? IDLE_STATUS);
          const ceiling = attemptCeiling(definition, node.id);
          const attempts =
            ceiling !== null && state?.iteration
              ? `${state.iteration}/${ceiling}`
              : null;

          return (
            <g
              key={node.id}
              className={`${styles.node} ${styles[visual.tone]}`}
              data-node={node.id}
              data-tone={visual.tone}
              role={interactive ? "button" : "group"}
              aria-label={`${node.id} — ${visual.label}`}
              tabIndex={interactive ? 0 : undefined}
              onClick={interactive ? () => onSelectNode(node.id) : undefined}
              onKeyDown={
                interactive
                  ? (event) => {
                      if (event.key !== "Enter" && event.key !== " ") {
                        return;
                      }

                      event.preventDefault();
                      onSelectNode(node.id);
                    }
                  : undefined
              }
            >
              <rect
                className={styles.box}
                x={node.x - NODE_WIDTH / 2}
                y={node.y - NODE_HEIGHT / 2}
                width={NODE_WIDTH}
                height={NODE_HEIGHT}
                rx={8}
              />
              <text
                className={styles.nodeId}
                x={node.x}
                y={node.y - 4}
                textAnchor="middle"
              >
                {node.id}
              </text>
              <text
                className={styles.nodeStatus}
                x={node.x}
                y={node.y + 12}
                textAnchor="middle"
              >
                {attempts ? `${visual.label} ${attempts}` : visual.label}
              </text>
            </g>
          );
        })}
      </svg>
    </section>
  );
}
