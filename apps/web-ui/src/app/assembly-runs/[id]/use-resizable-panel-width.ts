// The side panel's width, remembered per browser (run-viz FR4.14). Read as an external store: the server snapshot is the default, so the server-rendered markup and the first client render agree, and the stored width takes over once hydrated.
import { useCallback, useSyncExternalStore } from "react";
import {
  PANEL_WIDTH,
  PANEL_WIDTH_STORAGE_KEY,
  clampPanelWidth,
  readStoredWidth,
  type PanelWidthBounds,
} from "./resizable-panel";

// localStorage fires `storage` in OTHER tabs only; this tab hears its own writes through this event.
const WIDTH_CHANGED_EVENT = "lore:panel-width";

export function useResizablePanelWidth(
  storageKey: string = PANEL_WIDTH_STORAGE_KEY,
  bounds: PanelWidthBounds = PANEL_WIDTH,
) {
  const width = useSyncExternalStore(
    subscribeToWidth,
    () => readStoredWidth(window.localStorage, storageKey, bounds),
    () => bounds.default,
  );
  const setWidth = useCallback(
    (next: number) => writeWidth(storageKey, clampPanelWidth(next, bounds)),
    [storageKey, bounds],
  );

  return { width, setWidth };
}

function writeWidth(storageKey: string, width: number): void {
  window.localStorage.setItem(storageKey, String(width));
  window.dispatchEvent(new Event(WIDTH_CHANGED_EVENT));
}

function subscribeToWidth(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(WIDTH_CHANGED_EVENT, onChange);

  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(WIDTH_CHANGED_EVENT, onChange);
  };
}
