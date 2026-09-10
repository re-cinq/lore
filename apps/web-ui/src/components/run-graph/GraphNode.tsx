// One step in the graph: the box, selection, and one of three exclusive bodies (run verdict, outcome list, or plain name) — the aria-label follows the same choice.
import type { KeyboardEvent } from "react";
import type { LayoutNode } from "@/lib/dag-layout";
import type { GraphMode, VisibleNode } from "@/lib/graph-view-model";
import {
  nodeRunVisual,
  outcomeVisual,
  resultVisual,
  type NodeStatusVisual,
} from "@/lib/run-node-status";
import NodeMetaLine from "./NodeMetaLine";
import NodeOutcomeList from "./NodeOutcomeList";
import NodePlainLabel from "./NodePlainLabel";
import NodeRunBadge from "./NodeRunBadge";
import { NODE_WIDTH, nodeTextRows, titleCase } from "./run-graph-geometry";
import { classes } from "./run-graph-tone-classes";
import styles from "./run-graph.module.css";

export interface GraphNodeProps {
  node: LayoutNode;
  // Absent when the layout carries a node the visible graph does not.
  model: VisibleNode | undefined;
  mode: GraphMode;
  height: number;
  isTerminal: boolean;
  /** The node the inspector shows; drawn with a ring so the graph says which one. */
  selected?: boolean;
  /** Run mode facts under the verdict (model · duration · visits); empty draws nothing. */
  meta?: string;
  onSelect?: (nodeId: string) => void;
}

export default function GraphNode(props: GraphNodeProps) {
  const { node, model, mode, height, isTerminal, onSelect } = props;
  const badge = computeBadge(mode, model);
  const outcomes = model?.outcomes ?? [];
  const { top, leftEdge } = boxOf(node, height);
  const interaction = nodeInteraction(node.id, onSelect);
  const { baselines, metaLine } = nodeLines(props, badge, leftEdge);
  const body = { node, badge, baselines, outcomes, isTerminal, top, leftEdge };

  return (
    <g {...groupProps({ body, interaction, selected: props.selected })}>
      <NodeBox leftEdge={leftEdge} top={top} height={height} />
      <NodeBody {...body} title={titleCase(node.id)} />
      <NodeMetaLine {...metaLine} />
    </g>
  );
}

function computeBadge(
  mode: GraphMode,
  model: VisibleNode | undefined,
): NodeStatusVisual | null {
  if (mode !== "run" || !model) {
    return null;
  }

  return runBadge(model);
}

// Run-mode badge: the terminal shows the run result, an executed node its verdict, an in-flight one "Running".
function runBadge(node: VisibleNode): NodeStatusVisual {
  if (node.result !== null) {
    return resultVisual(node.result);
  }

  return nodeRunVisual(node.verdict, node.status, node.nodeType);
}

/** The box's top-left, from the layout's CENTRE point. The layout places node centres so edges can aim at them; SVG rects are drawn from a corner. */
function boxOf(node: GraphNodeProps["node"], height: number) {
  return { top: node.y - height / 2, leftEdge: node.x - NODE_WIDTH / 2 };
}

interface NodeInteraction {
  role: "button" | "group";
  tabIndex: number | undefined;
  onClick: (() => void) | undefined;
  onKeyDown: ((event: KeyboardEvent<SVGGElement>) => void) | undefined;
}

const INERT_INTERACTION: NodeInteraction = {
  role: "group",
  tabIndex: undefined,
  onClick: undefined,
  onKeyDown: undefined,
};

function nodeInteraction(
  nodeId: string,
  onSelect: ((nodeId: string) => void) | undefined,
): NodeInteraction {
  if (!onSelect) {
    return INERT_INTERACTION;
  }

  return {
    role: "button",
    tabIndex: 0,
    onClick: () => onSelect(nodeId),
    onKeyDown: selectOnActivationKey(nodeId, onSelect),
  };
}

// Enter and Space activate a node exactly as they activate a button; nothing else does.
function selectOnActivationKey(
  nodeId: string,
  onSelect: (nodeId: string) => void,
) {
  return (event: KeyboardEvent<SVGGElement>) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    onSelect(nodeId);
  };
}

/** What the box draws and where: the baselines its lines are centred on, and the facts line ready to render — empty when this visit has nothing to report, which is what makes the stack two lines instead of three. */
function nodeLines(
  props: GraphNodeProps,
  badge: ReturnType<typeof computeBadge>,
  leftEdge: number,
) {
  const meta = badge ? (props.meta ?? "") : "";
  const baselines = nodeTextRows(meta === "" ? 2 : 3);

  return {
    baselines,
    metaLine: {
      meta,
      leftEdge,
      centerY: props.node.y,
      baseline: baselines[2] ?? 0,
    },
  };
}

interface NodeBodyProps {
  badge: ReturnType<typeof computeBadge>;
  /** Baselines for this node's text lines, offsets from the box centre. */
  baselines: readonly number[];
  outcomes: readonly string[];
  title: string;
  node: GraphNodeProps["node"];
  top: number;
  leftEdge: number;
  isTerminal: boolean;
}

/** The group's own attributes. The tone lands on `data-tone` as well as in the class so a test can assert what a node is SAYING without going through the stylesheet, and the aria-label carries the outcome in words for a reader who cannot see the colour. */
function groupProps({
  body,
  interaction,
  selected,
}: {
  body: Pick<NodeBodyProps, "node" | "badge" | "outcomes" | "isTerminal">;
  interaction: ReturnType<typeof nodeInteraction>;
  selected: boolean | undefined;
}) {
  const { node, badge } = body;
  const isSelected = selected === true;

  return {
    className: nodeClassName({ badge, selected: isSelected }),
    "data-node": node.id,
    "data-tone": badge?.tone ?? "idle",
    "data-selected": isSelected || undefined,
    "aria-label": nodeAriaLabel(body),
    ...interactionAttrs({ interaction, selected: isSelected }),
  };
}

/** The node's tone class plus the selection ring. */
function nodeClassName({
  badge,
  selected,
}: {
  badge: NodeBodyProps["badge"];
  selected: boolean;
}): string {
  return classes(
    styles.node,
    badge ? styles[badge.tone] : undefined,
    selected ? styles.selected : undefined,
  );
}

/** How the group answers a click or a key, and whether it is the pressed one; a non-interactive node claims neither. */
function interactionAttrs({
  interaction,
  selected,
}: {
  interaction: ReturnType<typeof nodeInteraction>;
  selected: boolean;
}) {
  return {
    role: interaction.role,
    "aria-pressed": interaction.role === "button" ? selected : undefined,
    tabIndex: interaction.tabIndex,
    onClick: interaction.onClick,
    onKeyDown: interaction.onKeyDown,
  };
}

/** The node read aloud: whatever its body shows, in words. */
function nodeAriaLabel(
  body: Pick<NodeBodyProps, "node" | "badge" | "outcomes" | "isTerminal">,
): string {
  const { badge, outcomes, isTerminal } = body;
  const nodeId = body.node.id;

  if (badge) {
    return `${nodeId} — ${badge.label}`;
  }

  if (outcomes.length > 0) {
    const labels = outcomes.map((on) => outcomeVisual(on).label).join(", ");

    return `${nodeId}, possible outcomes: ${labels}`;
  }

  return isTerminal ? `${nodeId} — Terminal` : nodeId;
}

interface NodeBoxProps {
  leftEdge: number;
  top: number;
  height: number;
}

function NodeBox({ leftEdge, top, height }: NodeBoxProps) {
  return (
    <rect
      className={styles.box}
      x={leftEdge}
      y={top}
      width={NODE_WIDTH}
      height={height}
      rx={10}
    />
  );
}

/** What the box says, in precedence order: a run badge when this visit has an outcome, else the outcomes the definition declares, else the plain name. A node cannot show both — the badge IS the run's answer, and listing the possibilities beside it would read as though they were still open. */
function NodeBody(props: NodeBodyProps) {
  const { badge, outcomes, title, node, leftEdge, baselines } = props;

  if (badge) {
    return (
      <NodeRunBadge
        title={title}
        badge={badge}
        leftEdge={leftEdge}
        centerY={node.y}
        baselines={baselines}
      />
    );
  }

  if (outcomes.length > 0) {
    return (
      <NodeOutcomeList {...{ title, outcomes, leftEdge, top: props.top }} />
    );
  }

  return <PlainNodeBody {...props} />;
}

// Nothing to report: the node's name, and "Terminal" when the walk ends there.
function PlainNodeBody({ title, node, isTerminal }: NodeBodyProps) {
  return (
    <NodePlainLabel
      title={title}
      centerX={node.x}
      centerY={node.y}
      isTerminal={isTerminal}
    />
  );
}
