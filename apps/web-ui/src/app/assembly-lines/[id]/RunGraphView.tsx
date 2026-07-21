"use client";

// Client component: onSelectNode attaches an onClick, and a server component
// cannot pass an event handler across the boundary. Harmless today because
// page.tsx renders it without the prop, but #880 passes one.
// The definition DAG for one run: declarative SVG, no IO, no state.
//
// Declarative rather than imperative (the d3 SpecGraphD3 shell next door is the
// counter-example) so it renders and asserts in jsdom and needs no coverage
// exclusion. Every geometric decision already happened in layoutAssemblyLine —
// this file maps its output to elements and nothing else.

import type {
  AssemblyLineDefinition,
  DefinitionEdgeCondition,
} from "@/lib/assembly-line-definition";
import type { Box, LayoutEdge } from "@/lib/dag-layout";
import { layoutAssemblyLine } from "@/lib/dag-layout";
import type { NodeRunState } from "@/lib/run-event-reducer";
import { nodeStatusVisual } from "@/lib/run-node-status";
import styles from "./RunGraphView.module.css";

const NODE_WIDTH = 132;
const NODE_HEIGHT = 48;
const PADDING = 28;
// A lone node's content box is tiny; width:100% would then blow it up to fill
// the container. Floor the viewBox to a natural size and center the content in
// it so a single step sits at a readable scale instead of stretched edge to edge.
const MIN_VIEW_WIDTH = 480;
const MIN_VIEW_HEIGHT = 200;
const IDLE_STATUS = "idle" as const;

const TONE_CLASS: Record<EdgeTone, string> = {
  ok: styles.toneOk,
  warn: styles.toneWarn,
  err: styles.toneErr,
  neutral: styles.toneNeutral,
};

export interface RunGraphViewProps {
  definition: AssemblyLineDefinition | null;
  nodeStates: Record<string, NodeRunState>;
  /** Suppressed for a synthesized graph, whose conditions are a guess. */
  showEdgeLabels?: boolean;
  /**
   * Keys (`${from}-${to}-${on}`) of the edges the run actually traversed. When
   * non-empty the taken edges are drawn bold and the rest fade back; empty means
   * a definition-only view, where every edge renders at full weight.
   */
  takenEdges?: ReadonlySet<string>;
  onSelectNode?: (nodeId: string) => void;
}

type EdgeTone = "ok" | "warn" | "err" | "neutral";

interface FittedView {
  viewBox: string;
  /** Natural px width, also the SVG's max-width so a small graph renders at
   *  ~1:1 and centers rather than upscaling to fill the page. */
  width: number;
}

/** A padded viewBox around the content, floored to a natural size. Anchored to
 *  the content's left edge (a DAG reads left-to-right), and vertically centered;
 *  any slack from the min-width floor falls to the right, so a lone node sits at
 *  the left rather than marooned in the middle. */
function fitView(box: Box): FittedView {
  const width = Math.max(box.maxX - box.minX + PADDING * 2, MIN_VIEW_WIDTH);
  const height = Math.max(box.maxY - box.minY + PADDING * 2, MIN_VIEW_HEIGHT);
  const cy = (box.minY + box.maxY) / 2;

  return {
    viewBox: `${box.minX - PADDING} ${cy - height / 2} ${width} ${height}`,
    width,
  };
}

function edgeTone(on: DefinitionEdgeCondition): EdgeTone {
  if (on === "success") {
    return "ok";
  }

  if (on === "changes_requested") {
    return "warn";
  }

  return on === "failed" ? "err" : "neutral";
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

/** The definition graph with per-node run status. Pure render. */
export default function RunGraphView({
  definition,
  nodeStates,
  showEdgeLabels = true,
  takenEdges,
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
  const view = fitView(layout.contentBox);
  const titleId = `run-graph-title-${definition.name}`;
  const interactive = onSelectNode !== undefined;
  const hasTakenPath = (takenEdges?.size ?? 0) > 0;
  const nodesWithOutgoing = new Set(definition.edges.map((edge) => edge.from));

  return (
    <section className={styles.panel}>
      <h2 className={styles.heading}>Graph</h2>
      <svg
        className={styles.svg}
        style={{ maxWidth: `${view.width}px` }}
        role="img"
        aria-labelledby={titleId}
        viewBox={view.viewBox}
      >
        <title id={titleId}>{`Assembly line ${definition.name}`}</title>
        <defs>
          <marker
            id="rgv-arrow"
            markerWidth="8"
            markerHeight="8"
            refX="6.5"
            refY="3.5"
            orient="auto-start-reverse"
            markerUnits="userSpaceOnUse"
          >
            <path
              className={styles.arrowHead}
              d="M0.5 0.5 L6.5 3.5 L0.5 6.5 Z"
            />
          </marker>
        </defs>

        {layout.edges.map((edge) => {
          const key = edgeKey(edge);
          const isTaken = takenEdges?.has(key) ?? false;
          const groupClass = !hasTakenPath
            ? undefined
            : isTaken
              ? styles.taken
              : styles.dim;
          const toneClass = TONE_CLASS[edgeTone(edge.on)];

          return (
            <g key={key} className={groupClass} data-taken={isTaken}>
              <path
                className={[styles.edge, styles[edge.kind], toneClass]
                  .filter(Boolean)
                  .join(" ")}
                data-edge={key}
                data-kind={edge.kind}
                d={edge.d}
                markerEnd="url(#rgv-arrow)"
              />
              {showEdgeLabels ? (
                <text
                  className={[styles.edgeLabel, toneClass]
                    .filter(Boolean)
                    .join(" ")}
                  x={edge.labelX}
                  y={edge.labelY}
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
          const isTerminal = !nodesWithOutgoing.has(node.id);
          const statusLabel =
            isTerminal && visual.tone === "idle" ? "Terminal" : visual.label;
          const ceiling = attemptCeiling(definition, node.id);
          // iteration is 0 until a node actually starts; a "0/2" badge on a
          // pending node reads as a consumed attempt that never happened.
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
              aria-label={`${node.id} — ${statusLabel}`}
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
                {attempts ? `${statusLabel} ${attempts}` : statusLabel}
              </text>
            </g>
          );
        })}
      </svg>
    </section>
  );
}
