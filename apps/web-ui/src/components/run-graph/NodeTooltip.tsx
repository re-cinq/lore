"use client";

// The card a hovered or focused node shows (run-viz FR4.1h): its name and kind in the family's colour, and what its station does. Fixed to the viewport so the graph's scroll box cannot clip it; above the node, or below it when the node sits near the top of the screen.
import { useLayoutEffect, useRef } from "react";
import type { NodeTooltip as Tooltip } from "@/lib/node-tooltip";
import type { TooltipAnchor } from "./use-node-tooltip";
import { FAMILY_CLASS } from "./TypeGlyph";
import styles from "./run-graph.module.css";

// Room the card needs above a node before it flips below it.
const ROOM_ABOVE_PX = 160;
const GAP_PX = 8;

interface NodeTooltipProps {
  id: string;
  tooltip: Tooltip;
  anchor: TooltipAnchor;
}

export default function NodeTooltip({ id, tooltip, anchor }: NodeTooltipProps) {
  const card = usePlacedAt(anchor);

  return (
    <div
      ref={card}
      id={id}
      role="tooltip"
      className={`${styles.tooltip} ${FAMILY_CLASS[tooltip.family]}`}
      data-placement={placementOf(anchor).side}
    >
      <strong className={styles.tooltipTitle}>{tooltip.title}</strong>
      <span className={styles.tooltipKind}>{tooltip.kind}</span>
      <p className={styles.tooltipText}>{tooltip.description}</p>
    </div>
  );
}

/** Pins the card where the anchor says, after layout and before paint, so it never shows where it was last. */
function usePlacedAt(anchor: TooltipAnchor) {
  const card = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const element = card.current;

    if (element) {
      Object.assign(element.style, {
        left: `${anchor.left}px`,
        top: `${placementOf(anchor).top}px`,
      });
    }
  }, [anchor]);

  return card;
}

function placementOf(anchor: TooltipAnchor): {
  side: "above" | "below";
  top: number;
} {
  return anchor.top >= ROOM_ABOVE_PX
    ? { side: "above", top: anchor.top - GAP_PX }
    : { side: "below", top: anchor.bottom + GAP_PX };
}
