"use client";

// Which node's tooltip is up and where (run-viz FR4.1h). A hover waits a moment so a pointer crossing the graph does not flash every box; keyboard focus shows it at once; leaving, blurring, Escape and any scroll take it down.
import {
  useCallback,
  useEffect,
  useId,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

const HOVER_DELAY_MS = 250;

export interface TooltipAnchor {
  nodeId: string;
  left: number;
  top: number;
  bottom: number;
}

export interface NodeTooltipHandlers {
  onPointerOver: (event: PointerEvent<HTMLElement>) => void;
  onPointerOut: (event: PointerEvent<HTMLElement>) => void;
  onFocus: (event: FocusEvent<HTMLElement>) => void;
  onBlur: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}

export interface NodeTooltipState {
  id: string;
  anchor: TooltipAnchor | null;
  handlers: NodeTooltipHandlers;
}

export function useNodeTooltip(): NodeTooltipState {
  const id = useId();
  const [hovered, setHovered] = useState<TooltipAnchor | null>(null);
  const [anchor, setAnchor] = useState<TooltipAnchor | null>(null);
  const hide = useCallback(() => {
    setHovered(null);
    setAnchor(null);
  }, []);

  useEffect(() => showAfterDelay(hovered, setAnchor), [hovered]);
  useEffect(() => closeOnScroll(anchor, hide), [anchor, hide]);

  return { id, anchor, handlers: handlersFor({ setHovered, setAnchor, hide }) };
}

interface HandlerDeps {
  setHovered: (anchor: TooltipAnchor | null) => void;
  setAnchor: (anchor: TooltipAnchor) => void;
  hide: () => void;
}

function handlersFor({
  setHovered,
  setAnchor,
  hide,
}: HandlerDeps): NodeTooltipHandlers {
  return {
    onPointerOver: (event) => setHovered(anchorOf(event.target)),
    onPointerOut: (event) => {
      if (nodeOf(event.relatedTarget) !== nodeOf(event.target)) {
        hide();
      }
    },
    onFocus: (event) => showNow(anchorOf(event.target), setAnchor),
    onBlur: hide,
    onKeyDown: closeOnEscape(hide),
  };
}

function closeOnEscape(hide: () => void) {
  return (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      hide();
    }
  };
}

function showNow(
  found: TooltipAnchor | null,
  setAnchor: (anchor: TooltipAnchor) => void,
): void {
  if (found) {
    setAnchor(found);
  }
}

function showAfterDelay(
  hovered: TooltipAnchor | null,
  setAnchor: (anchor: TooltipAnchor) => void,
): (() => void) | undefined {
  if (!hovered) {
    return undefined;
  }
  const timer = setTimeout(() => setAnchor(hovered), HOVER_DELAY_MS);

  return () => clearTimeout(timer);
}

function closeOnScroll(
  anchor: TooltipAnchor | null,
  hide: () => void,
): (() => void) | undefined {
  if (!anchor) {
    return undefined;
  }
  const options = { capture: true };

  window.addEventListener("scroll", hide, options);

  return () => window.removeEventListener("scroll", hide, options);
}

/** The graph node an event happened on: the nearest group carrying `data-node`. */
function nodeOf(target: EventTarget | null): Element | null {
  return target instanceof Element ? target.closest("[data-node]") : null;
}

function anchorOf(target: EventTarget | null): TooltipAnchor | null {
  const node = nodeOf(target);
  const nodeId = node?.getAttribute("data-node");

  if (!node || !nodeId) {
    return null;
  }
  const box = node.getBoundingClientRect();

  return {
    nodeId,
    left: box.left + box.width / 2,
    top: box.top,
    bottom: box.bottom,
  };
}
