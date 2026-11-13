// The view of a diagram that can be dragged and zoomed: a translation in viewport pixels, then a scale.

export interface View {
  x: number;
  y: number;
  scale: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export const ZOOM_MIN = 0.2;
export const ZOOM_MAX = 4;

/** Zooms by a factor around a viewport point, which stays where it was on screen. */
export function zoomAt(view: View, factor: number, at: Point): View {
  const scale = Math.min(Math.max(view.scale * factor, ZOOM_MIN), ZOOM_MAX);
  const applied = scale / view.scale;

  return {
    x: at.x - (at.x - view.x) * applied,
    y: at.y - (at.y - view.y) * applied,
    scale,
  };
}

export function panBy(view: View, dx: number, dy: number): View {
  return { ...view, x: view.x + dx, y: view.y + dy };
}

/** The whole diagram in the viewport's width, never larger than its own size. */
export function fitView(diagram: Size, viewportWidth: number): View {
  const scale = Math.min(1, viewportWidth / diagram.width);

  return { x: 0, y: 0, scale: Math.max(scale, ZOOM_MIN) };
}
