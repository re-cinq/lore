"use client";

import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type PointerEvent,
  type RefObject,
  type SetStateAction,
} from "react";
import {
  DEFAULT_MOCKUP_HEIGHT,
  mermaidFrameHeight,
  mermaidSize,
} from "@/lib/mockup-frame";
import { fitView, panBy, zoomAt, type Point, type View } from "@/lib/pan-zoom";
import styles from "./MermaidCanvas.module.scss";

const NATURAL: View = { x: 0, y: 0, scale: 1 };
const BUTTON_STEP = 1.25;
const WHEEL_STEP = 1.1;
const MAX_VIEWPORT_HEIGHT = 640;

type SetView = Dispatch<SetStateAction<View>>;

interface MermaidCanvasProps {
  svg: string;
  title: string;
}

/** A mermaid diagram on the page, at its own size: dragged with the pointer, zoomed with the buttons or ctrl + wheel (a trackpad pinch). */
export default function MermaidCanvas({ svg, title }: MermaidCanvasProps) {
  const viewport = useRef<HTMLDivElement>(null);
  const [view, setView] = useState(NATURAL);
  const drag = useDragAndPinch(viewport, setView);

  return (
    <div className={styles.canvas}>
      <ZoomToolbar {...{ svg, view, setView, viewport }} />
      <div
        ref={viewport}
        role="img"
        aria-label={title}
        className={styles.viewport}
        style={{ height: viewportHeight(svg) }}
        {...drag}
      >
        <DiagramLayer svg={svg} view={view} />
      </div>
    </div>
  );
}

function DiagramLayer({ svg, view }: { svg: string; view: View }) {
  return (
    <div
      className={styles.diagram}
      style={{ transform: transformOf(view) }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

interface ZoomToolbarProps {
  svg: string;
  view: View;
  setView: SetView;
  viewport: RefObject<HTMLDivElement | null>;
}

function ZoomToolbar(props: ZoomToolbarProps) {
  const { zoom, fit } = zoomActions(props);

  return (
    <div className={styles.toolbar}>
      <button type="button" onClick={() => zoom(1 / BUTTON_STEP)}>
        Zoom out
      </button>
      <output className={styles.zoom}>
        {Math.round(props.view.scale * 100)}%
      </output>
      <button type="button" onClick={() => zoom(BUTTON_STEP)}>
        Zoom in
      </button>
      <button type="button" onClick={fit}>
        Fit
      </button>
    </div>
  );
}

function zoomActions({ svg, setView, viewport }: ZoomToolbarProps) {
  return {
    zoom: (factor: number) =>
      setView((view) => zoomAt(view, factor, centreOf(viewport.current))),
    fit: () =>
      setView(
        fitView(mermaidSize(svg) ?? NATURAL_SIZE, widthOf(viewport.current)),
      ),
  };
}

const NATURAL_SIZE = { width: 1, height: 1 };

function transformOf(view: View): string {
  return `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
}

function viewportHeight(svg: string): number {
  return Math.min(
    mermaidFrameHeight(svg) ?? DEFAULT_MOCKUP_HEIGHT,
    MAX_VIEWPORT_HEIGHT,
  );
}

function useDragAndPinch(
  viewport: RefObject<HTMLDivElement | null>,
  setView: SetView,
) {
  useWheelZoom(viewport, setView);

  return useDrag(setView);
}

function useDrag(setView: SetView) {
  const from = useRef<Point | null>(null);

  return {
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
      from.current = pointOf(event);
      captureDrag(event);
    },
    onPointerMove: (event: PointerEvent<HTMLDivElement>) =>
      dragTo(from, event, setView),
    onPointerUp: () => (from.current = null),
  };
}

function dragTo(
  from: RefObject<Point | null>,
  event: PointerEvent<HTMLDivElement>,
  setView: SetView,
): void {
  const start = from.current;

  if (!start) {
    return;
  }
  from.current = pointOf(event);
  setView((view) =>
    panBy(view, event.clientX - start.x, event.clientY - start.y),
  );
}

// A drag that leaves the viewport keeps following the pointer; a DOM without pointer capture (jsdom) just drags inside it.
function captureDrag({
  currentTarget,
  pointerId,
}: PointerEvent<HTMLDivElement>) {
  if ("setPointerCapture" in currentTarget) {
    currentTarget.setPointerCapture(pointerId);
  }
}

function pointOf(event: PointerEvent<HTMLDivElement>): Point {
  return { x: event.clientX, y: event.clientY };
}

// React listens to wheel passively, so the page would scroll too: the listener is added by hand to be able to stop it.
function useWheelZoom(
  viewport: RefObject<HTMLDivElement | null>,
  setView: SetView,
): void {
  useEffect(() => {
    const element = viewport.current;

    if (!element) {
      return;
    }
    const onWheel = (event: WheelEvent) => zoomOnPinch(event, element, setView);

    element.addEventListener("wheel", onWheel, { passive: false });

    return () => element.removeEventListener("wheel", onWheel);
  }, [viewport, setView]);
}

// A plain wheel scrolls the page past the diagram; ctrl or cmd with it, or a trackpad pinch, zooms at the pointer.
function zoomOnPinch(
  event: WheelEvent,
  element: HTMLElement,
  setView: SetView,
): void {
  if (!event.ctrlKey && !event.metaKey) {
    return;
  }
  event.preventDefault();
  const box = element.getBoundingClientRect();
  const factor = event.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP;
  const at = { x: event.clientX - box.left, y: event.clientY - box.top };

  setView((view) => zoomAt(view, factor, at));
}

function centreOf(element: HTMLElement | null): Point {
  return { x: widthOf(element) / 2, y: (element?.clientHeight ?? 0) / 2 };
}

function widthOf(element: HTMLElement | null): number {
  return element?.clientWidth ?? 0;
}
