// The side panel's width as a number (run-viz FR4.14): clamped here, not in CSS, so the separator's aria value, the stored value and the drawn width always agree.

export interface PanelWidthBounds {
  min: number;
  max: number;
  default: number;
}

export interface DragOrigin {
  startX: number;
  startWidth: number;
}

export const PANEL_WIDTH: PanelWidthBounds = {
  min: 280,
  max: 720,
  default: 380,
};

export const PANEL_WIDTH_STORAGE_KEY = "run-inspector-width";

export function clampPanelWidth(
  width: number,
  bounds: PanelWidthBounds,
): number {
  return Math.min(bounds.max, Math.max(bounds.min, width));
}

/** A right-hand panel grows as its handle moves LEFT, so the drag distance is taken off the start x. */
export function widthFromDrag(
  origin: DragOrigin,
  clientX: number,
  bounds: PanelWidthBounds,
): number {
  return clampPanelWidth(origin.startWidth - (clientX - origin.startX), bounds);
}

/** The width a viewer left last time; anything unreadable is the default rather than a panel of no width. */
export function readStoredWidth(
  storage: Pick<Storage, "getItem">,
  key: string,
  bounds: PanelWidthBounds,
): number {
  const stored = Number(storage.getItem(key));

  return Number.isFinite(stored) && stored > 0
    ? clampPanelWidth(stored, bounds)
    : bounds.default;
}
