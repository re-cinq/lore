"use client";

// The draggable left edge of the side panel (run-viz FR4.14): a vertical separator that reports the width it sets, dragged with a pointer or nudged with the arrow keys.
import { useRef } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import {
  clampPanelWidth,
  widthFromDrag,
  type DragOrigin,
  type PanelWidthBounds,
} from "./resizable-panel";
import styles from "./RunVisualizationPanel.module.css";

const KEY_STEP_PX = 16;
// The handle sits on the panel's LEFT edge: moving it left makes the panel wider.
const STEP_BY_KEY = new Map([
  ["ArrowLeft", KEY_STEP_PX],
  ["ArrowRight", -KEY_STEP_PX],
]);

interface ResizeHandleProps {
  width: number;
  bounds: PanelWidthBounds;
  onResize: (width: number) => void;
}

export function ResizeHandle(props: ResizeHandleProps) {
  const { width, bounds } = props;

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the selected node panel"
      aria-valuenow={width}
      aria-valuemin={bounds.min}
      aria-valuemax={bounds.max}
      tabIndex={0}
      className={styles.resizeHandle}
      {...useHandleEvents(props)}
    />
  );
}

/** The drag and the keyboard nudge, as the handlers the separator spreads. The drag origin is a ref: it changes on every pointer event and nothing renders from it. */
function useHandleEvents({ width, bounds, onResize }: ResizeHandleProps) {
  const originRef = useRef<DragOrigin | null>(null);
  const endDrag = () => {
    originRef.current = null;
  };

  return {
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
      originRef.current = { startX: event.clientX, startWidth: width };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
      if (originRef.current !== null) {
        onResize(widthFromDrag(originRef.current, event.clientX, bounds));
      }
    },
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
    onKeyDown: nudgeHandler({ width, bounds, onResize }),
  };
}

function nudgeHandler({ width, bounds, onResize }: ResizeHandleProps) {
  return (event: KeyboardEvent<HTMLDivElement>) => {
    const step = STEP_BY_KEY.get(event.key);

    if (step !== undefined) {
      onResize(clampPanelWidth(width + step, bounds));
    }
  };
}
