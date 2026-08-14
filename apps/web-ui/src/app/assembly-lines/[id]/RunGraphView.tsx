"use client";

// Renders a VisibleGraph — the mode-selected nodes and connectors from
// graph-view-model. It never derives what executed; it maps the model to SVG and
// nothing else (positions come from layoutAssemblyLine). Declarative so it renders
// and asserts in jsdom.
//
// Color lives inside nodes (verdict/result badges) and on branch connectors that
// route to different steps; a plain executed hop is a neutral gray connector with
// no label. Every node also carries its status as text, so meaning never rests on
// color alone.

import type { AssemblyLineDefinition } from "@/lib/assembly-line-definition";
import type { Box, LayoutEdge } from "@/lib/dag-layout";
import { layoutAssemblyLine } from "@/lib/dag-layout";
import {
  outcomeTone,
  type ConnectorTone,
  type VisibleGraph,
  type VisibleNode,
} from "@/lib/graph-view-model";
import {
  nodeRunVisual,
  outcomeVisual,
  resultVisual,
  type NodeStatusVisual,
} from "@/lib/run-node-status";
import styles from "./RunGraphView.module.css";

const NODE_WIDTH = 176;
const BASE_NODE_HEIGHT = 48;
const OUTCOME_ROW = 15;
const OUTCOME_TOP = 14;
const PADDING = 28;
const MIN_VIEW_WIDTH = 480;
const MIN_VIEW_HEIGHT = 200;

const TONE_CLASS: Record<ConnectorTone, string> = {
  ok: styles.toneOk,
  warn: styles.toneWarn,
  err: styles.toneErr,
  neutral: styles.toneNeutral,
};

const OUTCOME_FILL: Record<ConnectorTone, string> = {
  ok: styles.outOk,
  warn: styles.outWarn,
  err: styles.outErr,
  neutral: styles.outNeutral,
};

export interface RunGraphViewProps {
  graph: VisibleGraph;
  /** Source definition — supplies layout entry/exit and the graph name. */
  definition: AssemblyLineDefinition | null;
  onSelectNode?: (nodeId: string) => void;
  /** Section heading. `null` renders none, for a caller that titles the section
   *  itself — a second "Graph" inside a card called "How planning works" reads as
   *  two competing titles. */
  heading?: string | null;
}

interface FittedView {
  viewBox: string;
  width: number;
}

/** A padded viewBox around the content, floored to a natural size. */
function fitView(box: Box): FittedView {
  const width = Math.max(box.maxX - box.minX + PADDING * 2, MIN_VIEW_WIDTH);
  const height = Math.max(box.maxY - box.minY + PADDING * 2, MIN_VIEW_HEIGHT);
  const cy = (box.minY + box.maxY) / 2;

  return {
    viewBox: `${box.minX - PADDING} ${cy - height / 2} ${width} ${height}`,
    width,
  };
}

/** Uniform node height: taller in definition mode so a source node's outcome list
 *  fits inside its box. Run and bare definition nodes stay the base height. */
function nodeHeightFor(graph: VisibleGraph): number {
  if (graph.mode !== "definition") {
    return BASE_NODE_HEIGHT;
  }

  const rows = Math.max(0, ...graph.nodes.map((node) => node.outcomes.length));

  return rows > 0
    ? BASE_NODE_HEIGHT + OUTCOME_TOP + rows * OUTCOME_ROW
    : BASE_NODE_HEIGHT;
}

/** A layout-shaped definition from the visible graph; connectors carry no
 *  condition (structure only). */
function toLayoutDefinition(
  graph: VisibleGraph,
  definition: AssemblyLineDefinition | null,
): AssemblyLineDefinition {
  return {
    name: definition?.name ?? "workflow",
    description: "",
    version: 1,
    entry: definition?.entry ?? graph.nodes[0]?.id ?? "",
    exit: definition?.exit ?? "",
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      type: node.type,
    })) as AssemblyLineDefinition["nodes"],
    edges: graph.edges.map((edge) => ({
      from: edge.from,
      to: edge.to,
      on: "always" as const,
    })),
  };
}

/** The run-mode badge for a node: the terminal shows the run result, an executed
 *  node its verdict, and an in-flight one "Running". */
function runBadge(node: VisibleNode): NodeStatusVisual {
  if (node.result !== null) {
    return resultVisual(node.result);
  }

  return nodeRunVisual(node.verdict, node.status, node.signal);
}

const ICON_FILL: Record<string, string | undefined> = {
  ok: styles.iconOk,
  warn: styles.iconWarn,
  err: styles.iconErr,
  running: styles.iconRunning,
  waiting: styles.iconWaiting,
  idle: styles.iconIdle,
  neutral: styles.iconIdle,
};

const STATUS_FILL: Record<string, string | undefined> = {
  ok: styles.outOk,
  warn: styles.outWarn,
  err: styles.outErr,
  running: styles.outInfo,
  idle: styles.outNeutral,
  neutral: styles.outNeutral,
};

/** A small circular status glyph — check / dash / cross / dot — so a node's state
 *  reads without relying on color. */
function StatusIcon({
  tone,
  cx,
  cy,
  r = 8,
}: {
  tone: string;
  cx: number;
  cy: number;
  r?: number;
}) {
  const s = r / 8;

  return (
    <g aria-hidden="true">
      <circle
        cx={cx}
        cy={cy}
        r={r}
        className={ICON_FILL[tone] ?? styles.iconIdle}
      />
      {tone === "ok" ? (
        <path
          className={styles.iconGlyph}
          d={`M ${cx - 3.6 * s} ${cy + 0.3 * s} L ${cx - 1.2 * s} ${cy + 2.8 * s} L ${cx + 3.8 * s} ${cy - 3 * s}`}
        />
      ) : null}
      {tone === "err" ? (
        <path
          className={styles.iconGlyph}
          d={`M ${cx - 2.8 * s} ${cy - 2.8 * s} L ${cx + 2.8 * s} ${cy + 2.8 * s} M ${cx + 2.8 * s} ${cy - 2.8 * s} L ${cx - 2.8 * s} ${cy + 2.8 * s}`}
        />
      ) : null}
      {tone === "warn" ? (
        <path
          className={styles.iconGlyph}
          d={`M ${cx - 3.2 * s} ${cy} L ${cx + 3.2 * s} ${cy}`}
        />
      ) : null}
      {tone === "running" ? (
        <circle cx={cx} cy={cy} r={2.4 * s} className={styles.iconInner} />
      ) : null}
      {/* Pause bars: the walk is held here, not working. */}
      {tone === "waiting" ? (
        <path
          className={styles.iconGlyph}
          d={`M ${cx - 1.6 * s} ${cy - 2.6 * s} L ${cx - 1.6 * s} ${cy + 2.6 * s} M ${cx + 1.6 * s} ${cy - 2.6 * s} L ${cx + 1.6 * s} ${cy + 2.6 * s}`}
        />
      ) : null}
    </g>
  );
}

function titleCase(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1);
}

function edgeMapKey(from: string, to: string): string {
  return `${from}->${to}`;
}

/** The mode-selected workflow graph. Pure render of a VisibleGraph. */
export default function RunGraphView({
  graph,
  definition,
  onSelectNode,
  heading = "Graph",
}: RunGraphViewProps) {
  if (graph.nodes.length === 0) {
    return (
      <p className={styles.empty}>
        No assembly-line graph to show for this run.
      </p>
    );
  }

  const nodeHeight = nodeHeightFor(graph);
  const layout = layoutAssemblyLine(toLayoutDefinition(graph, definition), {
    nodeWidth: NODE_WIDTH,
    nodeHeight,
    rowGap: nodeHeight + 48,
  });
  const view = fitView(layout.contentBox);
  const titleId = `run-graph-title-${graph.mode}`;
  const interactive = onSelectNode !== undefined;
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const edgeByPair = new Map(
    graph.edges.map((edge) => [edgeMapKey(edge.from, edge.to), edge]),
  );
  const nodesWithOutgoing = new Set(graph.edges.map((edge) => edge.from));

  return (
    <section className={styles.panel}>
      {heading !== null && <h2 className={styles.heading}>{heading}</h2>}
      <svg
        className={styles.svg}
        style={{ ["--graph-width" as string]: `${view.width}px` }}
        role="img"
        aria-labelledby={titleId}
        viewBox={view.viewBox}
      >
        <title id={titleId}>{`Workflow graph (${graph.mode})`}</title>
        <defs>
          <marker
            id="rgv-arrow"
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

        {layout.edges.map((edge: LayoutEdge) => {
          const vm = edgeByPair.get(edgeMapKey(edge.from, edge.to));
          const toneClass = TONE_CLASS[vm?.tone ?? "neutral"];

          return (
            <g key={edgeMapKey(edge.from, edge.to)}>
              <path
                className={[styles.edge, styles[edge.kind], toneClass]
                  .filter(Boolean)
                  .join(" ")}
                data-edge={edgeMapKey(edge.from, edge.to)}
                data-tone={vm?.tone ?? "neutral"}
                d={edge.d}
                markerEnd="url(#rgv-arrow)"
              />
            </g>
          );
        })}

        {layout.nodes.map((node) => {
          const vm = nodeById.get(node.id);
          const isTerminal = !nodesWithOutgoing.has(node.id);
          const top = node.y - nodeHeight / 2;
          const leftEdge = node.x - NODE_WIDTH / 2;
          const title = titleCase(node.id);

          const badge = graph.mode === "run" && vm ? runBadge(vm) : null;
          const outcomes = vm?.outcomes ?? [];
          const ariaLabel = badge
            ? `${node.id} — ${badge.label}`
            : outcomes.length > 0
              ? `${node.id}, possible outcomes: ${outcomes
                  .map((on) => outcomeVisual(on).label)
                  .join(", ")}`
              : isTerminal
                ? `${node.id} — Terminal`
                : node.id;

          return (
            <g
              key={node.id}
              className={styles.node}
              data-node={node.id}
              data-tone={badge?.tone ?? "idle"}
              role={interactive ? "button" : "group"}
              aria-label={ariaLabel}
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
                x={leftEdge}
                y={top}
                width={NODE_WIDTH}
                height={nodeHeight}
                rx={10}
              />

              {badge ? (
                <>
                  <StatusIcon
                    tone={badge.tone}
                    cx={leftEdge + 24}
                    cy={node.y}
                  />
                  <text
                    className={styles.nodeId}
                    x={leftEdge + 40}
                    y={node.y - 2}
                    textAnchor="start"
                  >
                    {title}
                  </text>
                  <text
                    className={[styles.statusLabel, STATUS_FILL[badge.tone]]
                      .filter(Boolean)
                      .join(" ")}
                    x={leftEdge + 40}
                    y={node.y + 13}
                    textAnchor="start"
                  >
                    {badge.label}
                  </text>
                </>
              ) : outcomes.length > 0 ? (
                <>
                  <text
                    className={styles.nodeId}
                    x={leftEdge + 16}
                    y={top + 22}
                    textAnchor="start"
                  >
                    {title}
                  </text>
                  <text
                    className={styles.possibleLabel}
                    x={leftEdge + 16}
                    y={top + 38}
                    textAnchor="start"
                  >
                    Possible outcomes:
                  </text>
                  {outcomes.map((on, index) => {
                    const rowY = top + 55 + index * OUTCOME_ROW;

                    return (
                      <g key={on} data-outcome={on}>
                        <StatusIcon
                          tone={outcomeTone(on)}
                          cx={leftEdge + 22}
                          cy={rowY - 4}
                          r={6}
                        />
                        <text
                          className={[
                            styles.outcomeRow,
                            OUTCOME_FILL[outcomeTone(on)],
                          ]
                            .filter(Boolean)
                            .join(" ")}
                          x={leftEdge + 34}
                          y={rowY}
                          textAnchor="start"
                        >
                          {outcomeVisual(on).label}
                        </text>
                      </g>
                    );
                  })}
                </>
              ) : (
                <>
                  <text
                    className={styles.nodeId}
                    x={node.x}
                    y={isTerminal ? node.y - 4 : node.y + 4}
                    textAnchor="middle"
                  >
                    {title}
                  </text>
                  {isTerminal ? (
                    <text
                      className={styles.nodeStatus}
                      x={node.x}
                      y={node.y + 12}
                      textAnchor="middle"
                    >
                      Terminal
                    </text>
                  ) : null}
                </>
              )}
            </g>
          );
        })}
      </svg>
    </section>
  );
}
