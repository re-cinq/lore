"use client";

import { useCallback, useSyncExternalStore } from "react";

export const RAIL_STORAGE_KEY = "lore-sidebar-rail";

/** The two widths the sidebar can take beside the page. */
export type RailMode = "rail" | "full";

const listeners = new Set<() => void>();

// The choice for this visit, for a browser whose storage refuses it.
let remembered: RailMode = "full";

/** The remembered choice: storage when it answers, this visit's choice when it throws (private windows, previews). */
export function readRailMode(): RailMode {
  try {
    return window.localStorage.getItem(RAIL_STORAGE_KEY) === "1"
      ? "rail"
      : "full";
  } catch {
    return remembered;
  }
}

/** Remembers the choice and tells every reader; a storage that refuses it only costs the next visit its rail. */
export function storeRailMode(mode: RailMode): void {
  remembered = mode;

  try {
    window.localStorage.setItem(RAIL_STORAGE_KEY, mode === "rail" ? "1" : "0");
  } catch {
    // Storage is a convenience here; the toggle still works for this visit.
  }
  listeners.forEach((notify) => notify());
}

const serverMode = (): RailMode => "full";

/** The icon-only sidebar: expanded on the server, then the viewer's remembered choice. */
export function useRailMode(): [boolean, () => void] {
  const mode = useSyncExternalStore(subscribe, readRailMode, serverMode);
  const toggle = useCallback(
    () => storeRailMode(mode === "rail" ? "full" : "rail"),
    [mode],
  );

  return [mode === "rail", toggle];
}

function subscribe(notify: () => void) {
  listeners.add(notify);

  return () => {
    listeners.delete(notify);
  };
}
